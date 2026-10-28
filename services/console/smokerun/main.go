// Command smokerun walks one order from placement to delivery against the
// deployed APIs, the same steps as scripts/smoke-test.sh, and reports each
// step to the live console.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
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

var steps = []struct {
	name string
	fn   stepFunc
}{
	{"Preparing the smoke shop and driver", prepareUsers},
	{"Placing an order", placeOrder},
	{"Waiting for the driver offer", waitForOffer},
	{"Accepting the offer", acceptOffer},
	{"Driving to the customer", drive},
	{"Reading the ETA", readETA},
	{"Uploading the proof photo", uploadProof},
	{"Waiting for delivery", waitForDelivery},
}

type stepEvent struct {
	RunID  string `json:"runId"`
	Index  int    `json:"index"`
	Total  int    `json:"total"`
	Step   string `json:"step"`
	Status string `json:"status"` // running, passed or failed
	Detail string `json:"detail,omitempty"`
}

func (h handler) report(ctx context.Context, e stepEvent) {
	detail, _ := json.Marshal(e)
	if err := h.live.Publish(ctx, console.Event{Kind: "SmokeStep", At: time.Now().UTC(), Detail: detail}); err != nil {
		slog.Error("report smoke step", "step", e.Step, "err", err)
	}
}

func (h handler) handle(ctx context.Context, in struct {
	RunID string `json:"runId"`
}) error {
	defer h.unlock(in.RunID)

	r := &run{handler: h, id: in.RunID}
	for i, s := range steps {
		e := stepEvent{RunID: in.RunID, Index: i, Total: len(steps), Step: s.name, Status: "running"}
		h.report(ctx, e)
		detail, err := s.fn(ctx, r)
		e.Status, e.Detail = "passed", detail
		if err != nil {
			e.Status, e.Detail = "failed", err.Error()
		}
		h.report(ctx, e)
		if err != nil {
			// A failed smoke run is a result, not a Lambda error: the
			// console shows it, and async retries would start another run.
			slog.Error("smoke run failed", "runId", in.RunID, "step", s.name, "err", err)
			return nil
		}
	}
	return nil
}

// unlock frees the run lock unless it has already expired and been retaken.
func (h handler) unlock(runID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := h.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &h.consoleTable,
		Key: map[string]dbtypes.AttributeValue{
			"pk": &dbtypes.AttributeValueMemberS{Value: "SMOKE#LOCK"},
			"sk": &dbtypes.AttributeValueMemberS{Value: "LOCK"},
		},
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
	lambda.Start(handler{
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
	}.handle)
}
