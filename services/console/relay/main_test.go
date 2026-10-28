package main

import (
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestBusEventsPassThroughUnderTheirDetailType(t *testing.T) {
	got, err := toLive(events.CloudWatchEvent{DetailType: "OrderPlaced", Detail: json.RawMessage(`{"orderId":"o1"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "OrderPlaced" || string(got.Detail) != `{"orderId":"o1"}` {
		t.Errorf("got %+v", got)
	}
}

func TestWorkflowStatusKeepsOnlyOrderAndStatus(t *testing.T) {
	got, err := toLive(events.CloudWatchEvent{
		DetailType: workflowStatusChange,
		Detail:     json.RawMessage(`{"name":"o1","status":"FAILED","input":"{\"shopId\":\"s1\"}"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "WorkflowStatus" || string(got.Detail) != `{"orderId":"o1","status":"FAILED"}` {
		t.Errorf("got kind %q detail %s", got.Kind, got.Detail)
	}
}
