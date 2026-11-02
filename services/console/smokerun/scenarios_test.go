package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

func scenarioAWS(t *testing.T, serve http.HandlerFunc) aws.Config {
	t.Helper()
	server := httptest.NewServer(serve)
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	return aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1, BaseEndpoint: aws.String(server.URL),
	}
}

func TestQueuedRunsWithAnExpiredStolenOrUsedLockDoNoWork(t *testing.T) {
	for _, lock := range []struct {
		name, runID string
		expiresAt   int64
		started     bool
	}{
		{name: "missing"},
		{name: "expired", runID: "run-1", expiresAt: 0},
		{name: "stolen", runID: "other-run", expiresAt: time.Now().Add(time.Minute).Unix()},
		{name: "redelivered", runID: "run-1", expiresAt: time.Now().Add(time.Minute).Unix(), started: true},
	} {
		t.Run(lock.name, func(t *testing.T) {
			claims := 0
			cfg := scenarioAWS(t, func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".UpdateItem") {
					t.Errorf("unclaimed run contacted %q", r.Header.Get("X-Amz-Target"))
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				claims++
				var in struct {
					ConditionExpression                 string
					ReturnValuesOnConditionCheckFailure string
					ExpressionAttributeValues           map[string]struct{ S, N string }
				}
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					t.Error(err)
				}
				for _, guard := range []string{"runId = :id", "expiresAt > :now", "attribute_not_exists(startedAt)"} {
					if !strings.Contains(in.ConditionExpression, guard) {
						t.Errorf("claim is missing guard %q", guard)
					}
				}
				if in.ReturnValuesOnConditionCheckFailure != "ALL_OLD" {
					t.Error("claim cannot distinguish redelivery from expired admission")
				}
				now, err := strconv.ParseInt(in.ExpressionAttributeValues[":now"].N, 10, 64)
				if err != nil {
					t.Error(err)
				}
				if in.ExpressionAttributeValues[":id"].S == lock.runID && lock.expiresAt > now && !lock.started {
					t.Error("fixture unexpectedly allows a claim")
				}
				item := map[string]map[string]string{}
				if lock.runID != "" {
					item["runId"] = map[string]string{"S": lock.runID}
					item["expiresAt"] = map[string]string{"N": strconv.FormatInt(lock.expiresAt, 10)}
				}
				if lock.started {
					item["startedAt"] = map[string]string{"N": "1"}
				}
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]any{"__type": "ConditionalCheckFailedException", "message": "claim refused", "Item": item})
			})
			var reported []stepEvent
			reportServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				var payload struct {
					Events []string `json:"events"`
				}
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				for _, raw := range payload.Events {
					var event console.Event
					var step stepEvent
					if err := json.Unmarshal([]byte(raw), &event); err != nil {
						t.Error(err)
					}
					if event.Kind != "SmokeStep" {
						t.Errorf("unexpected terminal event %s", event.Kind)
					}
					if err := json.Unmarshal(event.Detail, &step); err != nil {
						t.Error(err)
					}
					reported = append(reported, step)
				}
				_, _ = w.Write([]byte(`{}`))
			}))
			t.Cleanup(reportServer.Close)
			reportClient := reportServer.Client()
			reportClient.Timeout = time.Second
			runCtx, cancel := context.WithCancel(t.Context())
			defer cancel()
			h := handler{
				db: dynamodb.NewFromConfig(cfg), env: env{consoleTable: "console"},
				live: console.Publisher{
					URL: reportServer.URL, Region: cfg.Region, Client: reportClient,
					Creds: aws.CredentialsProviderFunc(func(ctx context.Context) (aws.Credentials, error) {
						cancel() // Terminal reporting must survive cancellation of the run's context.
						return cfg.Credentials.Retrieve(ctx)
					}),
				},
			}
			result, err := h.handleQueue(runCtx, events.SQSEvent{
				Records: []events.SQSMessage{{MessageId: "message-1", Body: `{"runId":"run-1","scenario":"rush"}`}},
			})
			if err != nil || len(result.BatchItemFailures) != 0 || claims != 1 {
				t.Errorf("result = %+v, error = %v, claims = %d", result, err, claims)
			}
			if lock.started {
				if len(reported) != 0 {
					t.Errorf("redelivery changed the original run result: %+v", reported)
				}
			} else if len(reported) != 1 || reported[0].Status != "failed" || reported[0].RunID != "run-1" ||
				reported[0].Scenario != console.ScenarioRush || reported[0].Detail != errRunExpired.Error() {
				t.Errorf("terminal expiry report = %+v", reported)
			}
		})
	}
}

func TestQueueRejectsInvalidRunRequestsBeforeClaiming(t *testing.T) {
	for _, body := range []string{`{malformed`, `{"scenario":"rush"}`, `{"runId":"r1","scenario":"unknown"}`} {
		t.Run(body, func(t *testing.T) {
			response, err := (handler{}).handleQueue(t.Context(), events.SQSEvent{
				Records: []events.SQSMessage{{MessageId: "message-1", Body: body}},
			})
			if err != nil || len(response.BatchItemFailures) != 1 || response.BatchItemFailures[0].ItemIdentifier != "message-1" {
				t.Errorf("response = %+v, error = %v", response, err)
			}
		})
	}
}

func TestQueueRetriesATransientClaimFailure(t *testing.T) {
	cfg := scenarioAWS(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"__type":"ServiceUnavailableException","message":"unavailable"}`))
	})
	h := handler{db: dynamodb.NewFromConfig(cfg), env: env{consoleTable: "console"}}
	response, err := h.handleQueue(t.Context(), events.SQSEvent{
		Records: []events.SQSMessage{{MessageId: "message-1", Body: `{"runId":"r1","scenario":"rush"}`}},
	})
	if err != nil || len(response.BatchItemFailures) != 1 || response.BatchItemFailures[0].ItemIdentifier != "message-1" {
		t.Errorf("response = %+v, error = %v", response, err)
	}
}

func TestPauseStopsWhenTheRunIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := pause(ctx, time.Hour); !errors.Is(err, context.Canceled) {
		t.Errorf("pause error = %v", err)
	}
}

func TestCallBodySendsMalformedBytesToTheRealHTTPBoundary(t *testing.T) {
	var body, auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bytes, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		body, auth = string(bytes), r.Header.Get("Authorization")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"accepted"}`))
	}))
	t.Cleanup(server.Close)
	got, err := callBody(t.Context(), http.MethodPost, server.URL, "driver-token", strings.NewReader("{malformed"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if body != "{malformed" || auth != "driver-token" || string(got) != `{"status":"accepted"}` {
		t.Errorf("body = %q, auth = %q, response = %s", body, auth, got)
	}
}

func TestCleanupStopsOnlyThisRunsStillRunningExecutions(t *testing.T) {
	var described, stopped []string
	cfg := scenarioAWS(t, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ExecutionArn string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Error(err)
		}
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".DescribeExecution"):
			described = append(described, in.ExecutionArn)
			if strings.HasSuffix(in.ExecutionArn, ":done") {
				_, _ = w.Write([]byte(`{"status":"SUCCEEDED"}`))
			} else {
				_, _ = w.Write([]byte(`{"status":"RUNNING"}`))
			}
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".StopExecution"):
			stopped = append(stopped, in.ExecutionArn)
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected cleanup target %q", r.Header.Get("X-Amz-Target"))
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	r := &run{handler: handler{env: env{machine: "arn:aws:states:us-east-1:123456789012:stateMachine:dispatch"}, sfn: sfn.NewFromConfig(cfg)}, orders: []string{"running", "done"}}
	r.stopExecutions()
	if !slices.Equal(described, []string{r.executionARN("running"), r.executionARN("done")}) ||
		!slices.Equal(stopped, []string{r.executionARN("running")}) {
		t.Errorf("described = %v, stopped = %v", described, stopped)
	}
}

func TestConcurrentRetriesUseTheSameKeyAndRecordDistinctOrders(t *testing.T) {
	var mu sync.Mutex
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		mu.Lock()
		keys = append(keys, req.Header.Get("Idempotency-Key"))
		id := "order-" + strconv.Itoa(len(keys))
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"orderId": id})
	}))
	t.Cleanup(server.Close)
	r := &run{handler: handler{env: env{ordersAPI: server.URL}}, id: "shared-key"}
	if _, err := raceOrders(t.Context(), r); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(keys, []string{"shared-key", "shared-key"}) || len(r.orders) != 2 ||
		!contains(r.orders, "order-1") || !contains(r.orders, "order-2") {
		t.Errorf("keys = %v, orders = %v", keys, r.orders)
	}
}

func TestDuplicateProofReusesTheUploadURLAfterDelivery(t *testing.T) {
	uploads, urls := 0, 0
	var signedURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/orders/o1/proof":
			urls++
			if uploads > 0 {
				w.WriteHeader(http.StatusConflict)
				_, _ = w.Write([]byte(`{"error":"order is no longer assigned"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"url": signedURL})
		case req.Method == http.MethodPut && req.URL.Path == "/photo":
			uploads++
			w.WriteHeader(http.StatusOK)
		default:
			t.Errorf("unexpected proof request %s %s", req.Method, req.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	signedURL = server.URL + "/photo"
	r := &run{handler: handler{env: env{proofAPI: server.URL}}, orderID: "o1", driverToken: "driver-token"}
	for range 2 {
		if _, err := uploadProof(t.Context(), r); err != nil {
			t.Fatal(err)
		}
	}
	if urls != 1 || uploads != 2 {
		t.Errorf("upload URLs = %d, photo uploads = %d", urls, uploads)
	}
}

func TestFixturePreparationParksOnlyIdleDriversFromThePreviousTestFleet(t *testing.T) {
	profiles := map[string]map[string]map[string]string{
		"DRIVER#idle": {
			"id": {"S": "idle"}, "status": {"S": "AVAILABLE"}, "gsi1pk": {"S": "STATUS#AVAILABLE"}, "gsi1sk": {"S": "idle"},
		},
		"DRIVER#busy": {
			"id": {"S": "busy"}, "status": {"S": "BUSY"},
		},
		"DRIVER#offered": {
			"id": {"S": "offered"}, "status": {"S": "OFFERED"},
		},
	}
	cfg := scenarioAWS(t, func(w http.ResponseWriter, request *http.Request) {
		var in struct {
			TableName                 string
			Key                       map[string]struct{ S string }
			ConditionExpression       string
			UpdateExpression          string
			ExpressionAttributeValues map[string]struct{ S string }
		}
		if err := json.NewDecoder(request.Body).Decode(&in); err != nil {
			t.Error(err)
		}
		switch {
		case strings.HasSuffix(request.Header.Get("X-Amz-Target"), ".GetItem"):
			if in.TableName == "console" {
				_, _ = w.Write([]byte(`{"Item":{"drivers":{"L":[{"M":{"id":{"S":"idle"}}},{"M":{"id":{"S":"busy"}}},{"M":{"id":{"S":"offered"}}}]}}}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Item": profiles[in.Key["pk"].S]})
		case strings.HasSuffix(request.Header.Get("X-Amz-Target"), ".UpdateItem"):
			key := in.Key["pk"].S
			if key != "DRIVER#idle" || !strings.Contains(in.ConditionExpression, "gsi1pk = :available") ||
				!strings.Contains(in.UpdateExpression, "REMOVE gsi1pk, gsi1sk") {
				t.Errorf("unsafe fixture parking for %s: %+v", key, in)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			profiles[key]["status"] = map[string]string{"S": in.ExpressionAttributeValues[":offline"].S}
			delete(profiles[key], "gsi1pk")
			delete(profiles[key], "gsi1sk")
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected fleet operation %q", request.Header.Get("X-Amz-Target"))
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	r := &run{handler: handler{env: env{consoleTable: "console", driversTable: "drivers"}, db: dynamodb.NewFromConfig(cfg)}}
	if err := r.parkPreviousFleet(t.Context()); err != nil {
		t.Fatal(err)
	}
	if profiles["DRIVER#idle"]["status"]["S"] != "OFFLINE" || profiles["DRIVER#idle"]["gsi1pk"] != nil ||
		profiles["DRIVER#idle"]["gsi1sk"] != nil || profiles["DRIVER#busy"]["status"]["S"] != "BUSY" ||
		profiles["DRIVER#offered"]["status"]["S"] != "OFFERED" {
		t.Errorf("profiles after fixture preparation = %+v", profiles)
	}
	if _, err := console.ReadFleet(t.Context(), r.db, r.consoleTable, r.driversTable); err != nil {
		t.Errorf("parked fixture cannot be read: %v", err)
	}
}
