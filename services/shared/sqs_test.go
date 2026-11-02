package shared

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"reflect"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestSQSBatchContinuesAfterFailuresInRecordOrder(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	ctx := t.Context()
	records := []events.SQSMessage{
		{MessageId: "first", Body: " fail "},
		{MessageId: "second", Body: "ok"},
		{MessageId: "third", Body: "fail"},
		{MessageId: "fourth", Body: "last"},
	}
	var bodies []string
	response, err := SQSBatch(ctx, events.SQSEvent{Records: records}, "record line item", func(got context.Context, body string) error {
		if got != ctx {
			t.Error("record received a different context")
		}
		bodies = append(bodies, body)
		if body == " fail " || body == "fail" {
			return errors.New("write rejected")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(bodies, []string{" fail ", "ok", "fail", "last"}) {
		t.Errorf("processed bodies = %q", bodies)
	}
	want := []events.SQSBatchItemFailure{{ItemIdentifier: "first"}, {ItemIdentifier: "third"}}
	if !reflect.DeepEqual(response.BatchItemFailures, want) {
		t.Errorf("failures = %+v, want %+v", response.BatchItemFailures, want)
	}
	decoder := json.NewDecoder(&logs)
	for _, id := range []string{"first", "third"} {
		var entry map[string]any
		if err := decoder.Decode(&entry); err != nil {
			t.Fatal(err)
		}
		if entry["msg"] != "record line item" || entry["messageId"] != id || entry["err"] != "write rejected" || entry["level"] != "ERROR" {
			t.Errorf("log = %v", entry)
		}
	}
	if decoder.More() {
		t.Error("unexpected extra failure log")
	}
}

func TestSQSBatchKeepsNilFailuresForSuccessfulAndEmptyBatches(t *testing.T) {
	for _, records := range [][]events.SQSMessage{nil, {{MessageId: "one", Body: "ok"}}} {
		response, err := SQSBatch(t.Context(), events.SQSEvent{Records: records}, "process", func(context.Context, string) error { return nil })
		if err != nil || response.BatchItemFailures != nil {
			t.Errorf("response = %+v, error = %v", response, err)
		}
		body, marshalErr := json.Marshal(response)
		if marshalErr != nil || string(body) != `{"batchItemFailures":null}` {
			t.Errorf("response JSON = %s, error = %v", body, marshalErr)
		}
	}
}
