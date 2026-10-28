package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	lambdasvc "github.com/aws/aws-sdk-go-v2/service/lambda"
)

type fakeDB struct{ err error }

func (f fakeDB) PutItem(context.Context, *dynamodb.PutItemInput, ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	return &dynamodb.PutItemOutput{}, f.err
}

type fakeLambda struct{ calls []*lambdasvc.InvokeInput }

func (f *fakeLambda) Invoke(_ context.Context, in *lambdasvc.InvokeInput, _ ...func(*lambdasvc.Options)) (*lambdasvc.InvokeOutput, error) {
	f.calls = append(f.calls, in)
	return &lambdasvc.InvokeOutput{}, nil
}

func request(groups string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{RequestContext: events.APIGatewayProxyRequestContext{
		Authorizer: map[string]any{"claims": map[string]any{"cognito:groups": groups}},
	}}
}

func run(t *testing.T, db fakeDB, groups string) (events.APIGatewayProxyResponse, *fakeLambda) {
	t.Helper()
	fl := &fakeLambda{}
	h := handler{db: db, lambda: fl, table: "t", runner: "runner", now: func() time.Time { return time.Unix(1000, 0) }}
	resp, err := h.handle(context.Background(), request(groups))
	if err != nil {
		t.Fatal(err)
	}
	return resp, fl
}

func TestNonOpsUsersAreForbidden(t *testing.T) {
	resp, fl := run(t, fakeDB{}, "[shops drivers]")
	if resp.StatusCode != http.StatusForbidden || len(fl.calls) != 0 {
		t.Errorf("status %d, %d invokes", resp.StatusCode, len(fl.calls))
	}
}

func TestHeldLockReturnsConflict(t *testing.T) {
	resp, fl := run(t, fakeDB{err: &dbtypes.ConditionalCheckFailedException{}}, "[ops]")
	if resp.StatusCode != http.StatusConflict || len(fl.calls) != 0 {
		t.Errorf("status %d, %d invokes", resp.StatusCode, len(fl.calls))
	}
}

func TestStartsTheRunnerAsynchronously(t *testing.T) {
	resp, fl := run(t, fakeDB{}, "[ops]")
	if resp.StatusCode != http.StatusAccepted || len(fl.calls) != 1 {
		t.Fatalf("status %d, %d invokes", resp.StatusCode, len(fl.calls))
	}
	var body, payload struct{ RunID string }
	_ = json.Unmarshal([]byte(resp.Body), &body)
	_ = json.Unmarshal(fl.calls[0].Payload, &payload)
	if body.RunID == "" || body.RunID != payload.RunID || fl.calls[0].InvocationType != "Event" {
		t.Errorf("body %s, invoke %+v", resp.Body, fl.calls[0])
	}
}
