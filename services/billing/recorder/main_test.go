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

type billingBoundary struct {
	writeFails, eventFails bool
	lineItems              []json.RawMessage
	outcomes               []struct{ DetailType, Detail string }
}

func billingHandler(t *testing.T, boundary *billingBoundary) handler {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".TransactWriteItems"):
			if boundary.writeFails {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"__type":"TransactionCanceledException","message":"write rejected"}`))
				return
			}
			var request struct {
				TransactItems []struct {
					Put struct{ Item json.RawMessage }
				}
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if len(request.TransactItems) > 0 {
				boundary.lineItems = append(boundary.lineItems, request.TransactItems[0].Put.Item)
			}
			_, _ = w.Write([]byte(`{}`))
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
			_, _ = w.Write([]byte(`{"FailedEntryCount":0,"Entries":[{"EventId":"billing-event"}]}`))
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
		table:  "billing", fee: 4.99, bus: "bus",
	}
}

const deliveredMessage = `{"detail-type":"OrderDelivered","detail":{"orderId":"o1","shopId":"s1","deliveredAt":"2026-11-02T00:00:00Z"}}`

func TestRecordsAnOutcomeForTheWrittenLineItem(t *testing.T) {
	boundary := &billingBoundary{}
	if err := billingHandler(t, boundary).record(t.Context(), deliveredMessage); err != nil {
		t.Fatal(err)
	}
	if len(boundary.lineItems) != 1 || len(boundary.outcomes) != 1 {
		t.Fatalf("line items = %d, outcomes = %d", len(boundary.lineItems), len(boundary.outcomes))
	}
	var item map[string]struct{ S string }
	if err := json.Unmarshal(boundary.lineItems[0], &item); err != nil {
		t.Fatal(err)
	}
	var detail map[string]string
	if err := json.Unmarshal([]byte(boundary.outcomes[0].Detail), &detail); err != nil {
		t.Fatal(err)
	}
	if item["pk"].S != "SHOP#s1" || item["sk"].S != "LINE#2026-11#o1" ||
		boundary.outcomes[0].DetailType != "BillingLineRecorded" || detail["orderId"] != "o1" || detail["shopId"] != "s1" {
		t.Errorf("line item = %v, outcome = %+v", item, boundary.outcomes[0])
	}
}

func TestFailedLineItemWriteProducesNoOutcome(t *testing.T) {
	boundary := &billingBoundary{writeFails: true}
	if err := billingHandler(t, boundary).record(t.Context(), deliveredMessage); err == nil {
		t.Fatal("want the failed transaction to be reported")
	}
	if len(boundary.lineItems) != 0 || len(boundary.outcomes) != 0 {
		t.Errorf("line items = %d, outcomes = %d", len(boundary.lineItems), len(boundary.outcomes))
	}
}

func TestRejectedBillingOutcomeIsReturnedAsASQSFailure(t *testing.T) {
	boundary := &billingBoundary{eventFails: true}
	response, err := billingHandler(t, boundary).handle(t.Context(), events.SQSEvent{
		Records: []events.SQSMessage{{MessageId: "message-1", Body: deliveredMessage}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.BatchItemFailures) != 1 || response.BatchItemFailures[0].ItemIdentifier != "message-1" {
		t.Errorf("batch failures = %+v", response.BatchItemFailures)
	}
}
