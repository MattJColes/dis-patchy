package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	lambdasvc "github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type fakeDB struct {
	err      error
	calls    *int
	requests *[]*dynamodb.PutItemInput
}

func (f fakeDB) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	if f.calls != nil {
		*f.calls++
	}
	if f.requests != nil {
		*f.requests = append(*f.requests, in)
	}
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

type fakeQueue struct {
	messages []*sqs.SendMessageInput
	err      error
}

func (f *fakeQueue) SendMessage(_ context.Context, in *sqs.SendMessageInput, _ ...func(*sqs.Options)) (*sqs.SendMessageOutput, error) {
	f.messages = append(f.messages, in)
	return &sqs.SendMessageOutput{}, f.err
}

func TestScenarioRequiresOpsBeforeLockingOrEnqueuing(t *testing.T) {
	calls := 0
	queue := &fakeQueue{}
	h := handler{db: fakeDB{calls: &calls}, queue: queue}
	req := request("[shops]")
	req.Body = `{"scenario":"rush"}`
	response, err := h.handle(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden || calls != 0 || len(queue.messages) != 0 {
		t.Errorf("status = %d, locks = %d, messages = %d", response.StatusCode, calls, len(queue.messages))
	}
}

func TestInvalidScenarioDoesNotAcquireALock(t *testing.T) {
	for _, body := range []string{"", `{}`, `{"scenario":"unknown"}`, `{"scenario":"smoke"}`, `{malformed`} {
		t.Run(body, func(t *testing.T) {
			calls := 0
			queue := &fakeQueue{}
			h := handler{db: fakeDB{calls: &calls}, queue: queue}
			req := request("[ops]")
			req.Body = body
			response, err := h.handle(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusBadRequest || calls != 0 || len(queue.messages) != 0 {
				t.Errorf("status = %d, locks = %d, messages = %d", response.StatusCode, calls, len(queue.messages))
			}
		})
	}
}

func TestScenarioEnqueuesANewRunIDWithItsScenario(t *testing.T) {
	calls := 0
	queue := &fakeQueue{}
	h := handler{
		db: fakeDB{calls: &calls}, queue: queue, queueURL: "scenario-queue", table: "console",
		now: func() time.Time { return time.Unix(1000, 0) },
	}
	req := request("[ops]")
	req.Body = `{"scenario":"rush","runId":"caller-supplied"}`
	response, err := h.handle(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusAccepted || len(queue.messages) != 1 {
		t.Fatalf("status = %d, messages = %d", response.StatusCode, len(queue.messages))
	}
	var body struct{ RunID string }
	var queued console.RunRequest
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(*queue.messages[0].MessageBody), &queued); err != nil {
		t.Fatal(err)
	}
	if body.RunID == "" || body.RunID == "caller-supplied" || queued.RunID != body.RunID ||
		queued.Scenario != console.ScenarioRush || *queue.messages[0].QueueUrl != "scenario-queue" || calls != 1 {
		t.Errorf("body = %+v, queued = %+v, locks = %d", body, queued, calls)
	}
}

func TestHeldScenarioLockPreventsEnqueue(t *testing.T) {
	queue := &fakeQueue{}
	h := handler{
		db: fakeDB{err: &dbtypes.ConditionalCheckFailedException{}}, queue: queue,
		now: func() time.Time { return time.Unix(1000, 0) },
	}
	req := request("[ops]")
	req.Body = `{"scenario":"rush"}`
	response, err := h.handle(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict || len(queue.messages) != 0 {
		t.Errorf("status = %d, messages = %d", response.StatusCode, len(queue.messages))
	}
}

func TestScenarioAdmissionOutlivesQueueRetriesWhileSmokeKeepsItsShortLock(t *testing.T) {
	for _, test := range []struct {
		name string
		ttl  time.Duration
	}{
		{name: "smoke", ttl: 10 * time.Minute},
		{name: "scenario", ttl: 3 * time.Hour},
	} {
		t.Run(test.name, func(t *testing.T) {
			var requests []*dynamodb.PutItemInput
			now := time.Unix(1000, 0)
			h := handler{db: fakeDB{requests: &requests}, now: func() time.Time { return now }}
			if test.name == "scenario" {
				h.queue = &fakeQueue{}
			}
			if err := h.lock(t.Context(), "run-1"); err != nil {
				t.Fatal(err)
			}
			if len(requests) != 1 {
				t.Fatalf("lock writes = %d", len(requests))
			}
			expires := requests[0].Item["expiresAt"].(*dbtypes.AttributeValueMemberN).Value
			if expires != strconv.FormatInt(now.Add(test.ttl).Unix(), 10) {
				t.Errorf("expiresAt = %s, want %s", expires, now.Add(test.ttl))
			}
		})
	}
}
