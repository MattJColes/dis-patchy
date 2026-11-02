package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
)

type collectionBoundary struct {
	driver, status, collectedAt string
	eventFails, changed         bool
	outcomes                    []struct{ DetailType, Detail string }
}

func (b *collectionBoundary) item() map[string]map[string]string {
	item := map[string]map[string]string{
		"orderId": {"S": "o1"}, "shopId": {"S": "s1"}, "driverId": {"S": b.driver}, "status": {"S": b.status},
	}
	if b.collectedAt != "" {
		item["collectedAt"] = map[string]string{"S": b.collectedAt}
	}
	return item
}

func collectionHandler(t *testing.T, boundary *collectionBoundary) handler {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".GetItem"):
			_ = json.NewEncoder(w).Encode(map[string]any{"Item": boundary.item()})
			if boundary.changed {
				boundary.status = "DELIVERED"
			}
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".UpdateItem"):
			var request struct {
				ConditionExpression       string
				UpdateExpression          string
				ExpressionAttributeValues map[string]struct{ S string }
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			guarded := strings.Contains(request.ConditionExpression, "#status = :assigned") &&
				strings.Contains(request.ConditionExpression, "driverId = :driver")
			if !guarded || request.ExpressionAttributeValues[":assigned"].S != boundary.status ||
				request.ExpressionAttributeValues[":driver"].S != boundary.driver {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"__type":"ConditionalCheckFailedException","message":"assignment changed"}`))
				return
			}
			if boundary.collectedAt == "" || !strings.Contains(request.UpdateExpression, "if_not_exists") {
				boundary.collectedAt = request.ExpressionAttributeValues[":at"].S
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Attributes": boundary.item()})
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".PutEvents"):
			if boundary.eventFails {
				_, _ = w.Write([]byte(`{"FailedEntryCount":1,"Entries":[{"ErrorCode":"InternalFailure"}]}`))
				return
			}
			var request struct {
				Entries []struct{ DetailType, Detail string }
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			boundary.outcomes = append(boundary.outcomes, request.Entries...)
			_, _ = w.Write([]byte(`{"FailedEntryCount":0,"Entries":[{"EventId":"collection-event"}]}`))
		default:
			t.Errorf("unexpected AWS target %q", r.Header.Get("X-Amz-Target"))
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	cfg := aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1,
	}
	return handler{
		db:     dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		events: eventbridge.NewFromConfig(cfg, func(o *eventbridge.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		table:  "orders", bus: "bus",
	}
}

func collectionRequest(groups, driver string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		PathParameters: map[string]string{"orderId": "o1"},
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]any{"claims": map[string]any{"cognito:groups": groups, "sub": driver}},
		},
	}
}

func TestAssignedDriverCanCollectAParcel(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "ASSIGNED"}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d1"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || boundary.collectedAt == "" || len(boundary.outcomes) != 1 {
		t.Fatalf("response = %+v, timestamp = %q, outcomes = %v", response, boundary.collectedAt, boundary.outcomes)
	}
	var detail map[string]string
	if err := json.Unmarshal([]byte(boundary.outcomes[0].Detail), &detail); err != nil {
		t.Fatal(err)
	}
	if boundary.status != "ASSIGNED" || boundary.outcomes[0].DetailType != "OrderCollected" ||
		detail["orderId"] != "o1" || detail["driverId"] != "d1" || detail["shopId"] != "s1" || detail["collectedAt"] != boundary.collectedAt {
		t.Errorf("state = %+v, outcome = %+v", boundary, detail)
	}
}

func TestCollectionRequiresAnIdentifiedDriver(t *testing.T) {
	for _, caller := range []struct{ groups, driver string }{{"[shops]", "d1"}, {"[drivers]", ""}} {
		t.Run(caller.groups+caller.driver, func(t *testing.T) {
			response, err := (handler{}).handle(t.Context(), collectionRequest(caller.groups, caller.driver))
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusForbidden {
				t.Errorf("status = %d", response.StatusCode)
			}
		})
	}
}

func TestAnotherDriverCannotSeeOrCollectTheOrder(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "ASSIGNED"}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d2"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusNotFound || boundary.collectedAt != "" || len(boundary.outcomes) != 0 {
		t.Errorf("response = %+v, state = %+v", response, boundary)
	}
}

func TestCollectionRequiresAnOrderID(t *testing.T) {
	request := collectionRequest("[drivers]", "d1")
	request.PathParameters = nil
	response, err := (handler{}).handle(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d", response.StatusCode)
	}
}

func TestDeliveredOrdersCannotBeCollected(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "DELIVERED"}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d1"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict || boundary.collectedAt != "" || len(boundary.outcomes) != 0 {
		t.Errorf("response = %+v, state = %+v", response, boundary)
	}
}

func TestCollectionRejectsAnAssignmentChangedAfterReading(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "ASSIGNED", changed: true}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d1"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict || boundary.collectedAt != "" || len(boundary.outcomes) != 0 {
		t.Errorf("response = %+v, state = %+v", response, boundary)
	}
}

func TestRepeatedCollectionPreservesTheOriginalTimestamp(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "ASSIGNED", collectedAt: "2026-11-02T01:02:03Z"}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d1"))
	if err != nil {
		t.Fatal(err)
	}
	var body struct{ CollectedAt string }
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || body.CollectedAt != "2026-11-02T01:02:03Z" ||
		boundary.collectedAt != "2026-11-02T01:02:03Z" {
		t.Errorf("response = %+v, timestamp = %q", response, boundary.collectedAt)
	}
}

func TestRejectedCollectionEventDoesNotReportSuccess(t *testing.T) {
	boundary := &collectionBoundary{driver: "d1", status: "ASSIGNED", eventFails: true}
	response, err := collectionHandler(t, boundary).handle(t.Context(), collectionRequest("[drivers]", "d1"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusInternalServerError || len(boundary.outcomes) != 0 {
		t.Errorf("response = %+v, outcomes = %+v", response, boundary.outcomes)
	}
}
