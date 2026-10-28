// Command relay forwards bus events and dispatch workflow status changes to
// the live console.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
)

const workflowStatusChange = "Step Functions Execution Status Change"

// toLive keeps the console payload small: workflow events carry the whole
// execution input, and only the order and status matter on screen.
func toLive(e events.CloudWatchEvent) (console.Event, error) {
	if e.DetailType != workflowStatusChange {
		return console.Event{Kind: e.DetailType, At: e.Time, Detail: e.Detail}, nil
	}
	var execution struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(e.Detail, &execution); err != nil {
		return console.Event{}, err
	}
	// Executions are named after their order (see dispatch/starter).
	detail, err := json.Marshal(map[string]string{"orderId": execution.Name, "status": execution.Status})
	return console.Event{Kind: "WorkflowStatus", At: e.Time, Detail: detail}, err
}

type handler struct {
	live console.Publisher
}

func (h handler) handle(ctx context.Context, e events.CloudWatchEvent) error {
	event, err := toLive(e)
	if err != nil {
		return err
	}
	if err := h.live.Publish(ctx, event); err != nil {
		slog.Error("publish live event", "kind", event.Kind, "err", err)
	}
	return nil
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{live: console.NewPublisher(os.Getenv("EVENTS_HTTP_DNS"), cfg.Region, cfg.Credentials)}.handle)
}
