// Command pingrelay is a second consumer on the driver ping stream that
// forwards positions to the live console.
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

type handler struct {
	live console.Publisher
}

func (h handler) handle(ctx context.Context, e events.KinesisEvent) error {
	live := make([]console.Event, 0, len(e.Records))
	for _, record := range e.Records {
		if !json.Valid(record.Kinesis.Data) {
			slog.Warn("skipping undecodable ping", "eventId", record.EventID)
			continue
		}
		live = append(live, console.Event{Kind: "Ping", At: record.Kinesis.ApproximateArrivalTimestamp.UTC(), Detail: record.Kinesis.Data})
	}
	// Never fail the batch: a retry would stall the shard for an animation.
	if err := h.live.Publish(ctx, live...); err != nil {
		slog.Error("publish pings", "count", len(live), "err", err)
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
