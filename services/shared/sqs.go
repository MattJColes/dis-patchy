package shared

import (
	"context"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
)

// SQSBatch processes every message and reports only the failures for redelivery.
func SQSBatch(ctx context.Context, e events.SQSEvent, logMessage string, process func(context.Context, string) error) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse
	for _, record := range e.Records {
		if err := process(ctx, record.Body); err != nil {
			slog.Error(logMessage, "messageId", record.MessageId, "err", err)
			resp.BatchItemFailures = append(resp.BatchItemFailures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return resp, nil
}
