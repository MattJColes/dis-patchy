// Command delivered runs when a proof-of-delivery photo lands in S3: it
// closes the order, announces OrderDelivered and texts the customer.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/aws/aws-sdk-go-v2/service/sns"
)

type handler struct {
	db     *dynamodb.Client
	events *eventbridge.Client
	sns    *sns.Client
	table  string
	bus    string
}

// orderIDFromKey extracts the order from proof/{orderId}/{filename}.
func orderIDFromKey(rawKey string) (string, error) {
	key, err := url.QueryUnescape(rawKey)
	if err != nil {
		return "", err
	}
	parts := strings.SplitN(key, "/", 3)
	if len(parts) != 3 || parts[0] != "proof" || parts[1] == "" {
		return "", fmt.Errorf("unexpected key %q", key)
	}
	return parts[1], nil
}

func (h handler) markDelivered(ctx context.Context, orderID string, at time.Time) (orders.Order, error) {
	pk, sk := orders.Key(orderID)
	out, err := h.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &h.table,
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: sk},
		},
		ConditionExpression:      aws.String("attribute_exists(pk)"),
		UpdateExpression:         aws.String("SET #status = :delivered, deliveredAt = :at"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":delivered": &types.AttributeValueMemberS{Value: string(orders.StatusDelivered)},
			":at":        &types.AttributeValueMemberS{Value: at.Format(time.RFC3339)},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		return orders.Order{}, err
	}
	var order orders.Order
	err = attributevalue.UnmarshalMap(out.Attributes, &order)
	return order, err
}

func (h handler) process(ctx context.Context, record events.S3EventRecord) error {
	orderID, err := orderIDFromKey(record.S3.Object.Key)
	if err != nil {
		return err
	}
	order, err := h.markDelivered(ctx, orderID, record.EventTime.UTC())
	if err != nil {
		return fmt.Errorf("mark %s delivered: %w", orderID, err)
	}

	detail, _ := json.Marshal(map[string]any{
		"orderId":     order.OrderID,
		"shopId":      order.ShopID,
		"deliveredAt": record.EventTime.UTC(),
	})
	_, err = h.events.PutEvents(ctx, &eventbridge.PutEventsInput{Entries: []ebtypes.PutEventsRequestEntry{{
		EventBusName: &h.bus,
		Source:       aws.String("dispatchy.proof"),
		DetailType:   aws.String("OrderDelivered"),
		Detail:       aws.String(string(detail)),
	}}})
	if err != nil {
		return err
	}

	log.Printf("order %s delivered, notifying %s on %s", order.OrderID, order.CustomerName, order.CustomerPhone)
	_, err = h.sns.Publish(ctx, &sns.PublishInput{
		PhoneNumber: &order.CustomerPhone,
		Message:     aws.String(fmt.Sprintf("Your dis-patchy order %s has been delivered.", order.OrderID[:8])),
	})
	return err
}

func (h handler) handle(ctx context.Context, e events.S3Event) error {
	for _, record := range e.Records {
		if err := h.process(ctx, record); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		db:     dynamodb.NewFromConfig(cfg),
		events: eventbridge.NewFromConfig(cfg),
		sns:    sns.NewFromConfig(cfg),
		table:  os.Getenv("ORDERS_TABLE"),
		bus:    os.Getenv("BUS_NAME"),
	}.handle)
}
