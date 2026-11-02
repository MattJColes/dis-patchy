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
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
)

type notificationBoundary struct {
	emailFails, eventFails bool
	emails                 int
	outcomes               []struct{ DetailType, Detail string }
}

func notificationHandler(t *testing.T, boundary *notificationBoundary) handler {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".GetItem"):
			var request struct{ Key map[string]struct{ S string } }
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if request.Key["pk"].S != "ORDER#o1" {
				_, _ = w.Write([]byte(`{}`))
				return
			}
			_, _ = w.Write([]byte(`{"Item":{"orderId":{"S":"o1"},"customerName":{"S":"Customer"},"customerEmail":{"S":"customer@example.com"},"dropoffAddress":{"S":"1 Main St"}}}`))
		case r.URL.Path == "/v2/email/outbound-emails":
			if boundary.emailFails {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"message":"email rejected","code":"MessageRejected"}`))
				return
			}
			boundary.emails++
			_, _ = w.Write([]byte(`{"MessageId":"ses-message-1"}`))
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
			_, _ = w.Write([]byte(`{"FailedEntryCount":0,"Entries":[{"EventId":"notification-event"}]}`))
		default:
			t.Errorf("unexpected AWS request %s %q", r.URL.Path, r.Header.Get("X-Amz-Target"))
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
		ses:    sesv2.NewFromConfig(cfg, func(o *sesv2.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		events: eventbridge.NewFromConfig(cfg, func(o *eventbridge.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		table:  "orders", sender: "sender@example.com", bus: "bus",
	}
}

func TestAcceptedEmailProducesAProviderConfirmation(t *testing.T) {
	boundary := &notificationBoundary{}
	body := `{"detail-type":"DriverAssigned","detail":{"order_id":"o1"}}`
	if err := notificationHandler(t, boundary).notify(t.Context(), body); err != nil {
		t.Fatal(err)
	}
	if boundary.emails != 1 || len(boundary.outcomes) != 1 {
		t.Fatalf("emails = %d, outcomes = %d", boundary.emails, len(boundary.outcomes))
	}
	var detail map[string]string
	if err := json.Unmarshal([]byte(boundary.outcomes[0].Detail), &detail); err != nil {
		t.Fatal(err)
	}
	if boundary.outcomes[0].DetailType != "NotificationAccepted" || detail["orderId"] != "o1" ||
		detail["notification"] != "DriverAssigned" || detail["messageId"] != "ses-message-1" || len(detail) != 3 {
		t.Errorf("outcome = %+v", boundary.outcomes[0])
	}
}

func TestRejectedEmailProducesNoConfirmation(t *testing.T) {
	boundary := &notificationBoundary{emailFails: true}
	body := `{"detail-type":"OrderDelivered","detail":{"order_id":"o1"}}`
	if err := notificationHandler(t, boundary).notify(t.Context(), body); err == nil {
		t.Fatal("want the SES failure to be reported")
	}
	if boundary.emails != 0 || len(boundary.outcomes) != 0 {
		t.Errorf("emails = %d, outcomes = %d", boundary.emails, len(boundary.outcomes))
	}
}

func TestExistingCamelCaseEventStillProducesNoEmail(t *testing.T) {
	boundary := &notificationBoundary{}
	body := `{"detail-type":"DriverAssigned","detail":{"orderId":"o1"}}`
	if err := notificationHandler(t, boundary).notify(t.Context(), body); err != nil {
		t.Fatal(err)
	}
	if boundary.emails != 0 || len(boundary.outcomes) != 0 {
		t.Errorf("emails = %d, outcomes = %d", boundary.emails, len(boundary.outcomes))
	}
}

func TestRejectedNotificationConfirmationIsReturnedAsASQSFailure(t *testing.T) {
	boundary := &notificationBoundary{eventFails: true}
	response, err := notificationHandler(t, boundary).handle(t.Context(), events.SQSEvent{
		Records: []events.SQSMessage{{MessageId: "message-1", Body: `{"detail-type":"DriverAssigned","detail":{"order_id":"o1"}}`}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.BatchItemFailures) != 1 || response.BatchItemFailures[0].ItemIdentifier != "message-1" ||
		boundary.emails != 1 || len(boundary.outcomes) != 0 {
		t.Errorf("failures = %+v, emails = %d, outcomes = %+v", response.BatchItemFailures, boundary.emails, boundary.outcomes)
	}
}

func TestNotificationBatchContinuesAfterInvalidMessages(t *testing.T) {
	boundary := &notificationBoundary{}
	body := `{"detail-type":"DriverAssigned","detail":{"order_id":"o1"}}`
	response, err := notificationHandler(t, boundary).handle(t.Context(), events.SQSEvent{
		Records: []events.SQSMessage{
			{MessageId: "invalid", Body: "{"},
			{MessageId: "first", Body: body},
			{MessageId: "unknown", Body: `{"detail-type":"Unknown"}`},
			{MessageId: "second", Body: body},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.BatchItemFailures) != 2 || response.BatchItemFailures[0].ItemIdentifier != "invalid" ||
		response.BatchItemFailures[1].ItemIdentifier != "unknown" || boundary.emails != 2 || len(boundary.outcomes) != 2 {
		t.Errorf("failures = %+v, emails = %d, outcomes = %+v", response.BatchItemFailures, boundary.emails, boundary.outcomes)
	}
}
