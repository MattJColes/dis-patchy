// Command smokerun walks one order from placement to delivery against the
// deployed APIs, the same steps as scripts/smoke-test.sh, and reports each
// step to the live console.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

type env struct {
	poolID, clientID, customerEmail     string
	driversTable, consoleTable, machine string
	ordersAPI, dispatchAPI, trackingAPI string
	proofAPI                            string
}

type handler struct {
	env
	cognito *cip.Client
	db      *dynamodb.Client
	sfn     *sfn.Client
	live    console.Publisher
}

type stepFunc func(context.Context, *run) (string, error)

var errRunExpired = errors.New("test run expired before it could start; start a new run")

var steps = []struct {
	name string
	fn   stepFunc
}{
	{"Preparing the smoke shop and driver", prepareUsers},
	{"Placing an order", placeOrder},
	{"Waiting for the driver offer", waitForOffer},
	{"Accepting the offer", acceptOffer},
	{"Collecting the parcel", collectParcel},
	{"Driving to the customer", drive},
	{"Reading the ETA", readETA},
	{"Uploading the proof photo", uploadProof},
	{"Waiting for delivery", waitForDelivery},
}

type stepEvent struct {
	RunID    string           `json:"runId"`
	Index    int              `json:"index"`
	Total    int              `json:"total"`
	Step     string           `json:"step"`
	Status   string           `json:"status"` // running, passed or failed
	Detail   string           `json:"detail,omitempty"`
	Scenario console.Scenario `json:"scenario"`
}

func (h handler) report(ctx context.Context, e stepEvent) {
	detail, _ := json.Marshal(e)
	if err := h.live.Publish(ctx, console.Event{Kind: "SmokeStep", At: time.Now().UTC(), Detail: detail}); err != nil {
		slog.Error("report smoke step", "step", e.Step, "err", err)
	}
}

func (h handler) handle(ctx context.Context, in console.RunRequest) error {
	if in.Scenario == "" {
		in.Scenario = console.ScenarioSmoke
	}
	if !in.Scenario.Valid() || in.RunID == "" {
		return errors.New("invalid test run")
	}
	claimed, err := h.claim(ctx, in.RunID)
	if errors.Is(err, errRunExpired) {
		reportCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.report(reportCtx, stepEvent{
			RunID: in.RunID, Scenario: in.Scenario, Index: 0, Total: len(scenarioSteps),
			Step: scenarioSteps[0].name, Status: "failed", Detail: err.Error(),
		})
		return nil
	}
	if err != nil || !claimed {
		return err
	}
	defer h.unlock(in.RunID)

	// Keep enough of the Lambda budget to stop only this run's test executions.
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	r := &run{handler: h, id: in.RunID, scenario: in.Scenario}
	defer r.stopExecutions()
	runSteps := steps
	if in.Scenario != console.ScenarioSmoke {
		runSteps = scenarioSteps
	}
	for i, s := range runSteps {
		e := stepEvent{RunID: in.RunID, Scenario: in.Scenario, Index: i, Total: len(runSteps), Step: s.name, Status: "running"}
		h.report(ctx, e)
		detail, err := s.fn(ctx, r)
		e.Status, e.Detail = "passed", detail
		if err != nil {
			e.Status, e.Detail = "failed", err.Error()
			reportCtx, reportCancel := context.WithTimeout(context.Background(), 5*time.Second)
			h.report(reportCtx, e)
			h.reportFleet(reportCtx)
			reportCancel()
		} else {
			h.report(ctx, e)
		}
		if err != nil {
			// A failed smoke run is a result, not a Lambda error: the
			// console shows it, and async retries would start another run.
			slog.Error("smoke run failed", "runId", in.RunID, "step", s.name, "err", err)
			return nil
		}
	}
	h.reportFleet(ctx)
	return nil
}

// claim prevents a queue redelivery from repeating non-idempotent API calls.
func (h handler) claim(ctx context.Context, runID string) (bool, error) {
	_, err := h.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &h.consoleTable, Key: lockKey(),
		UpdateExpression:                    aws.String("SET startedAt = :now"),
		ConditionExpression:                 aws.String("runId = :id AND expiresAt > :now AND attribute_not_exists(startedAt)"),
		ReturnValuesOnConditionCheckFailure: dbtypes.ReturnValuesOnConditionCheckFailureAllOld,
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":id":  &dbtypes.AttributeValueMemberS{Value: runID},
			":now": &dbtypes.AttributeValueMemberN{Value: fmt.Sprint(time.Now().Unix())},
		},
	})
	var duplicate *dbtypes.ConditionalCheckFailedException
	if errors.As(err, &duplicate) {
		owner, _ := duplicate.Item["runId"].(*dbtypes.AttributeValueMemberS)
		if owner != nil && owner.Value == runID && duplicate.Item["startedAt"] != nil {
			return false, nil
		}
		return false, errRunExpired
	}
	return err == nil, err
}

func lockKey() map[string]dbtypes.AttributeValue {
	return map[string]dbtypes.AttributeValue{
		"pk": &dbtypes.AttributeValueMemberS{Value: "SMOKE#LOCK"}, "sk": &dbtypes.AttributeValueMemberS{Value: "LOCK"},
	}
}

func (h handler) handleQueue(ctx context.Context, e events.SQSEvent) (events.SQSEventResponse, error) {
	var result events.SQSEventResponse
	for _, record := range e.Records {
		var in console.RunRequest
		err := json.Unmarshal([]byte(record.Body), &in)
		if err == nil {
			err = h.handle(ctx, in)
		}
		if err != nil {
			slog.Error("scenario run", "messageId", record.MessageId, "err", err)
			result.BatchItemFailures = append(result.BatchItemFailures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return result, nil
}

func (h handler) reportFleet(ctx context.Context) {
	fleet, err := console.ReadFleet(ctx, h.db, h.consoleTable, h.driversTable)
	if err != nil {
		slog.Error("read test fleet", "err", err)
		return
	}
	detail, err := json.Marshal(fleet)
	if err == nil {
		err = h.live.Publish(ctx, console.Event{Kind: "FleetSnapshot", At: time.Now().UTC(), Detail: detail})
	}
	if err != nil {
		slog.Error("report test fleet", "err", err)
	}
}

// unlock frees the run lock unless it has already expired and been retaken.
func (h handler) unlock(runID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := h.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName:                 &h.consoleTable,
		Key:                       lockKey(),
		ConditionExpression:       aws.String("runId = :id"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":id": &dbtypes.AttributeValueMemberS{Value: runID}},
	})
	if err != nil {
		slog.Warn("release smoke lock", "runId", runID, "err", err)
	}
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	h := handler{
		env: env{
			poolID:        os.Getenv("USER_POOL_ID"),
			clientID:      os.Getenv("SMOKE_CLIENT_ID"),
			customerEmail: os.Getenv("CUSTOMER_EMAIL"),
			driversTable:  os.Getenv("DRIVERS_TABLE"),
			consoleTable:  os.Getenv("CONSOLE_TABLE"),
			machine:       os.Getenv("STATE_MACHINE_ARN"),
			ordersAPI:     os.Getenv("ORDERS_API"),
			dispatchAPI:   os.Getenv("DISPATCH_API"),
			trackingAPI:   os.Getenv("TRACKING_API"),
			proofAPI:      os.Getenv("PROOF_API"),
		},
		cognito: cip.NewFromConfig(cfg),
		db:      dynamodb.NewFromConfig(cfg),
		sfn:     sfn.NewFromConfig(cfg),
		live:    console.NewPublisher(os.Getenv("EVENTS_HTTP_DNS"), cfg.Region, cfg.Credentials),
	}
	if os.Getenv("SCENARIO_WORKER") == "true" {
		lambda.Start(h.handleQueue)
	} else {
		lambda.Start(h.handle)
	}
}
