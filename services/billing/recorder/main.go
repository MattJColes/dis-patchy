// Command recorder turns OrderDelivered events into billable line items.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type orderDelivered struct {
	OrderID     string    `json:"orderId"`
	ShopID      string    `json:"shopId"`
	DeliveredAt time.Time `json:"deliveredAt"`
}

type lineItem struct {
	PK          string    `dynamodbav:"pk"`
	SK          string    `dynamodbav:"sk"`
	OrderID     string    `dynamodbav:"orderId"`
	Amount      float64   `dynamodbav:"amount"`
	DeliveredAt time.Time `dynamodbav:"deliveredAt"`
}

type handler struct {
	db    *dynamodb.Client
	table string
	fee   float64
}

func (h handler) record(ctx context.Context, body string) error {
	var envelope events.CloudWatchEvent
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return err
	}
	var d orderDelivered
	if err := json.Unmarshal(envelope.Detail, &d); err != nil {
		return err
	}

	// Keyed by order, so a redelivered event overwrites rather than
	// double-bills.
	item, err := attributevalue.MarshalMap(lineItem{
		PK:          "SHOP#" + d.ShopID,
		SK:          "LINE#" + d.DeliveredAt.Format("2006-01") + "#" + d.OrderID,
		OrderID:     d.OrderID,
		Amount:      h.fee,
		DeliveredAt: d.DeliveredAt,
	})
	if err != nil {
		return err
	}
	_, err = h.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Put: &types.Put{TableName: &h.table, Item: item}},
		{Put: &types.Put{TableName: &h.table, Item: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: "SHOP#" + d.ShopID},
			"sk": &types.AttributeValueMemberS{Value: "PROFILE"},
		}}},
	}})
	return err
}

func (h handler) handle(ctx context.Context, e events.SQSEvent) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse
	for _, record := range e.Records {
		if err := h.record(ctx, record.Body); err != nil {
			slog.Error("record line item", "messageId", record.MessageId, "err", err)
			resp.BatchItemFailures = append(resp.BatchItemFailures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return resp, nil
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	fee, err := strconv.ParseFloat(os.Getenv("DELIVERY_FEE"), 64)
	if err != nil {
		panic("DELIVERY_FEE must be a number: " + err.Error())
	}
	lambda.Start(handler{db: dynamodb.NewFromConfig(cfg), table: os.Getenv("BILLING_TABLE"), fee: fee}.handle)
}
