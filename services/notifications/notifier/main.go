// Command notifier emails the customer when their order is picked up by a
// driver and when it is delivered.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sestypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

type orderEvent struct {
	OrderID string `json:"order_id"`
}

var templates = map[string]struct{ subject, body string }{
	"DriverAssigned": {
		subject: "Your order is on its way",
		body:    "Hi %s,\n\nA driver has picked up your order and is heading to %s.\n\n- dis-patchy",
	},
	"OrderDelivered": {
		subject: "Your order has been delivered",
		body:    "Hi %s,\n\nYour order was delivered to %s.\n\n- dis-patchy",
	},
}

type handler struct {
	db     *dynamodb.Client
	ses    *sesv2.Client
	table  string
	sender string
	events *eventbridge.Client
	bus    string
}

func (h handler) notify(ctx context.Context, body string) error {
	var envelope events.CloudWatchEvent
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return err
	}
	tmpl, ok := templates[envelope.DetailType]
	if !ok {
		return fmt.Errorf("no template for %q", envelope.DetailType)
	}
	var e orderEvent
	if err := json.Unmarshal(envelope.Detail, &e); err != nil {
		return err
	}

	order, err := orders.Read(ctx, h.db, h.table, e.OrderID)
	if err != nil {
		return err
	}
	if order == nil {
		// Orders are never deleted, so this is a stale or test event.
		slog.Warn("order not found, skipping notification", "orderId", e.OrderID, "detailType", envelope.DetailType)
		return nil
	}

	out, err := h.ses.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: &h.sender,
		Destination:      &sestypes.Destination{ToAddresses: []string{order.CustomerEmail}},
		Content: &sestypes.EmailContent{Simple: &sestypes.Message{
			Subject: &sestypes.Content{Data: aws.String(tmpl.subject)},
			Body: &sestypes.Body{Text: &sestypes.Content{
				Data: aws.String(fmt.Sprintf(tmpl.body, order.CustomerName, order.DropoffAddress)),
			}},
		}},
	})
	if err != nil {
		return err
	}
	return shared.PublishEvent(ctx, h.events, h.bus, "dispatchy.notifications", "NotificationAccepted", map[string]string{
		"orderId": order.OrderID, "notification": envelope.DetailType, "messageId": aws.ToString(out.MessageId),
	})
}

func (h handler) handle(ctx context.Context, e events.SQSEvent) (events.SQSEventResponse, error) {
	return shared.SQSBatch(ctx, e, "send notification", h.notify)
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		db:     dynamodb.NewFromConfig(cfg),
		ses:    sesv2.NewFromConfig(cfg),
		table:  os.Getenv("ORDERS_TABLE"),
		sender: os.Getenv("SENDER_EMAIL"),
		events: eventbridge.NewFromConfig(cfg),
		bus:    os.Getenv("BUS_NAME"),
	}.handle)
}
