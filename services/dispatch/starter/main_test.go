package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

func TestDispatchBatchAcknowledgesExistingExecutionsAndContinuesAfterFailures(t *testing.T) {
	var names []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct{ StateMachineArn, Name, Input string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		names = append(names, request.Name)
		var input map[string]string
		if err := json.Unmarshal([]byte(request.Input), &input); err != nil {
			t.Error(err)
		}
		if request.StateMachineArn != "arn:aws:states:us-east-1:123456789012:stateMachine:dispatch" ||
			input["orderId"] != request.Name || input["shopId"] != "s1" || len(input) != 2 {
			t.Errorf("request = %+v", request)
		}
		switch request.Name {
		case "existing":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"__type":"ExecutionAlreadyExists","message":"already started"}`))
		case "denied":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"__type":"AccessDeniedException","message":"denied"}`))
		default:
			_, _ = w.Write([]byte(`{"executionArn":"arn:aws:states:us-east-1:123456789012:execution:dispatch:new","startDate":1}`))
		}
	}))
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	h := handler{
		sfn: sfn.NewFromConfig(aws.Config{
			Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
			HTTPClient: client, RetryMaxAttempts: 1,
		}, func(o *sfn.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		stateMachine: "arn:aws:states:us-east-1:123456789012:stateMachine:dispatch",
	}
	response, err := h.handle(t.Context(), events.SQSEvent{Records: []events.SQSMessage{
		{MessageId: "malformed", Body: "{"},
		{MessageId: "duplicate", Body: `{"detail":{"orderId":"existing","shopId":"s1"}}`},
		{MessageId: "rejected", Body: `{"detail":{"orderId":"denied","shopId":"s1"}}`},
		{MessageId: "accepted", Body: `{"detail":{"orderId":"new","shopId":"s1"}}`},
	}})
	if err != nil {
		t.Fatal(err)
	}
	want := []events.SQSBatchItemFailure{{ItemIdentifier: "malformed"}, {ItemIdentifier: "rejected"}}
	if !reflect.DeepEqual(response.BatchItemFailures, want) || !reflect.DeepEqual(names, []string{"existing", "denied", "new"}) {
		t.Errorf("failures = %+v, executions = %v", response.BatchItemFailures, names)
	}
}
