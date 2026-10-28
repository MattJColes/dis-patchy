// Command starter turns OrderPlaced events from the intake queue into
// dispatch workflow executions, one per order.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	"github.com/aws/aws-sdk-go-v2/service/sfn/types"
)

type orderPlaced struct {
	OrderID string `json:"orderId"`
	ShopID  string `json:"shopId"`
}

type handler struct {
	sfn          *sfn.Client
	stateMachine string
}

func (h handler) start(ctx context.Context, body string) error {
	var envelope events.CloudWatchEvent
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return err
	}
	var detail orderPlaced
	if err := json.Unmarshal(envelope.Detail, &detail); err != nil {
		return err
	}
	input, err := json.Marshal(detail)
	if err != nil {
		return err
	}

	// Naming the execution after the order makes redelivery a no-op.
	_, err = h.sfn.StartExecution(ctx, &sfn.StartExecutionInput{
		StateMachineArn: &h.stateMachine,
		Name:            aws.String(detail.OrderID),
		Input:           aws.String(string(input)),
	})
	var exists *types.ExecutionAlreadyExists
	if errors.As(err, &exists) {
		return nil
	}
	return err
}

func (h handler) handle(ctx context.Context, e events.SQSEvent) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse
	for _, record := range e.Records {
		if err := h.start(ctx, record.Body); err != nil {
			slog.Error("start dispatch", "messageId", record.MessageId, "err", err)
			resp.BatchItemFailures = append(resp.BatchItemFailures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return resp, nil
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{sfn: sfn.NewFromConfig(cfg), stateMachine: os.Getenv("STATE_MACHINE_ARN")}.handle)
}
