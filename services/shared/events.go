package shared

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

// PublishEvent announces completed work without including customer contact details.
func PublishEvent(ctx context.Context, client *eventbridge.Client, bus, source, kind string, detail any) error {
	body, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	out, err := client.PutEvents(ctx, &eventbridge.PutEventsInput{Entries: []types.PutEventsRequestEntry{{
		EventBusName: &bus, Source: &source, DetailType: &kind, Detail: aws.String(string(body)),
	}}})
	if err != nil {
		return fmt.Errorf("publish %s: %w", kind, err)
	}
	if out.FailedEntryCount != 0 {
		if len(out.Entries) == 0 {
			return fmt.Errorf("publish %s: rejected without an entry result", kind)
		}
		return fmt.Errorf("publish %s: %s", kind, aws.ToString(out.Entries[0].ErrorCode))
	}
	return nil
}
