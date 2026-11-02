package shared

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
)

func eventClient(t *testing.T, serve http.HandlerFunc) *eventbridge.Client {
	t.Helper()
	server := httptest.NewServer(serve)
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	return eventbridge.NewFromConfig(aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1,
	}, func(o *eventbridge.Options) { o.BaseEndpoint = aws.String(server.URL) })
}

func TestPublishEventCarriesTheCompletedWork(t *testing.T) {
	var body struct {
		Entries []struct {
			EventBusName, Source, DetailType, Detail string
		}
	}
	client := eventClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		_, _ = w.Write([]byte(`{"FailedEntryCount":0,"Entries":[{"EventId":"event-1"}]}`))
	})
	detail := map[string]string{"orderId": "o1", "messageId": "message-1"}
	if err := PublishEvent(t.Context(), client, "bus", "dispatchy.notifications", "NotificationAccepted", detail); err != nil {
		t.Fatal(err)
	}
	if len(body.Entries) != 1 {
		t.Fatalf("got %d entries", len(body.Entries))
	}
	got := body.Entries[0]
	var actual map[string]string
	if err := json.Unmarshal([]byte(got.Detail), &actual); err != nil {
		t.Fatal(err)
	}
	if got.EventBusName != "bus" || got.Source != "dispatchy.notifications" || got.DetailType != "NotificationAccepted" ||
		len(actual) != 2 || actual["orderId"] != "o1" || actual["messageId"] != "message-1" {
		t.Errorf("event = %+v, detail = %v", got, actual)
	}
}

func TestPublishEventReportsARejectedEntryDespiteHTTP200(t *testing.T) {
	client := eventClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"FailedEntryCount":1,"Entries":[{"ErrorCode":"AccessDeniedException"}]}`))
	})
	err := PublishEvent(t.Context(), client, "bus", "source", "BillingLineRecorded", map[string]string{"orderId": "o1"})
	if err == nil || !strings.Contains(err.Error(), "BillingLineRecorded") || !strings.Contains(err.Error(), "AccessDeniedException") {
		t.Errorf("error = %v", err)
	}
}

func TestPublishEventReportsAnUnavailableProvider(t *testing.T) {
	client := eventClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"__type":"ServiceUnavailableException","message":"unavailable"}`))
	})
	if err := PublishEvent(t.Context(), client, "bus", "source", "OrderCollected", map[string]string{"orderId": "o1"}); err == nil {
		t.Fatal("want a provider error")
	}
}

func TestPublishEventDoesNotSendUnencodableDetails(t *testing.T) {
	client := eventClient(t, func(http.ResponseWriter, *http.Request) {
		t.Error("unencodable details reached EventBridge")
	})
	if err := PublishEvent(context.Background(), client, "bus", "source", "OrderCollected", make(chan int)); err == nil {
		t.Fatal("want a JSON encoding error")
	}
}
