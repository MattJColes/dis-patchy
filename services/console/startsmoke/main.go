// Command startsmoke lets an ops user start a smoke run from the console.
// One run at a time: the smoke shop and driver are shared.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	lambdasvc "github.com/aws/aws-sdk-go-v2/service/lambda"
	lambdatypes "github.com/aws/aws-sdk-go-v2/service/lambda/types"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/google/uuid"
)

// The lock outlives a run that crashes before releasing it, but not for long.
const lockTTL = 10 * time.Minute

type putter interface {
	PutItem(context.Context, *dynamodb.PutItemInput, ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
}

type invoker interface {
	Invoke(context.Context, *lambdasvc.InvokeInput, ...func(*lambdasvc.Options)) (*lambdasvc.InvokeOutput, error)
}

type sender interface {
	SendMessage(context.Context, *sqs.SendMessageInput, ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
}

type handler struct {
	db       putter
	lambda   invoker
	table    string
	runner   string
	now      func() time.Time
	queue    sender
	queueURL string
}

func (h handler) lock(ctx context.Context, runID string) error {
	now := h.now()
	ttl := lockTTL
	if h.queue != nil {
		// Five queue deliveries, 30 minutes apart, must fit before admission expires.
		ttl = 3 * time.Hour
	}
	_, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.table,
		Item: map[string]dbtypes.AttributeValue{
			"pk":        &dbtypes.AttributeValueMemberS{Value: "SMOKE#LOCK"},
			"sk":        &dbtypes.AttributeValueMemberS{Value: "LOCK"},
			"runId":     &dbtypes.AttributeValueMemberS{Value: runID},
			"expiresAt": &dbtypes.AttributeValueMemberN{Value: strconv.FormatInt(now.Add(ttl).Unix(), 10)},
		},
		// TTL deletes lazily, so an expired lock counts as free.
		ConditionExpression:       aws.String("attribute_not_exists(pk) OR expiresAt < :now"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":now": &dbtypes.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)}},
	})
	return err
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if !shared.InGroup(req, "ops") {
		return shared.Error(http.StatusForbidden, "ops only")
	}
	in := console.RunRequest{Scenario: console.ScenarioSmoke}
	if h.queue != nil {
		if err := json.Unmarshal([]byte(req.Body), &in); err != nil || !in.Scenario.Valid() || in.Scenario == console.ScenarioSmoke {
			return shared.Error(http.StatusBadRequest, "a supported scenario is required")
		}
	}

	runID := uuid.NewString()
	var held *dbtypes.ConditionalCheckFailedException
	switch err := h.lock(ctx, runID); {
	case errors.As(err, &held):
		return shared.Error(http.StatusConflict, "a test run is already in progress")
	case err != nil:
		return shared.Internal(err)
	}

	in.RunID = runID
	payload, err := json.Marshal(in)
	if err != nil {
		return shared.Internal(err)
	}
	if h.queue != nil {
		_, err = h.queue.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: &h.queueURL, MessageBody: aws.String(string(payload))})
	} else {
		_, err = h.lambda.Invoke(ctx, &lambdasvc.InvokeInput{
			FunctionName: &h.runner, InvocationType: lambdatypes.InvocationTypeEvent, Payload: payload,
		})
	}
	if err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusAccepted, map[string]string{"runId": runID})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	h := handler{
		db:     dynamodb.NewFromConfig(cfg),
		lambda: lambdasvc.NewFromConfig(cfg),
		table:  os.Getenv("CONSOLE_TABLE"),
		runner: os.Getenv("RUNNER_FUNCTION"),
		now:    time.Now,
	}
	if h.queueURL = os.Getenv("SCENARIO_QUEUE_URL"); h.queueURL != "" {
		h.queue = sqs.NewFromConfig(cfg)
	}
	lambda.Start(h.handle)
}
