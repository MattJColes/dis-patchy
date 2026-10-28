// Command invoice totals a shop's line items for a month, writes the CSV
// invoice to S3 and records the invoice in the billing table.
package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type invoiceJob struct {
	ShopID string `json:"shopId"`
	Period string `json:"period"`
}

type lineItem struct {
	OrderID string  `dynamodbav:"orderId"`
	Amount  float64 `dynamodbav:"amount"`
}

type handler struct {
	db     *dynamodb.Client
	s3     *s3.Client
	table  string
	bucket string
}

func (h handler) lineItems(ctx context.Context, job invoiceJob) ([]lineItem, error) {
	out, err := h.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &h.table,
		KeyConditionExpression: aws.String("pk = :shop AND begins_with(sk, :period)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":shop":   &types.AttributeValueMemberS{Value: "SHOP#" + job.ShopID},
			":period": &types.AttributeValueMemberS{Value: "LINE#" + job.Period + "#"},
		},
	})
	if err != nil {
		return nil, err
	}
	var items []lineItem
	err = attributevalue.UnmarshalListOfMaps(out.Items, &items)
	return items, err
}

func (h handler) invoice(ctx context.Context, job invoiceJob) error {
	items, err := h.lineItems(ctx, job)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"order_id", "amount"})
	var total float64
	for _, it := range items {
		total += it.Amount
		_ = w.Write([]string{it.OrderID, strconv.FormatFloat(it.Amount, 'f', 2, 64)})
	}
	_ = w.Write([]string{"TOTAL", strconv.FormatFloat(total, 'f', 2, 64)})
	w.Flush()
	if err := w.Error(); err != nil {
		return err
	}

	key := fmt.Sprintf("invoices/%s/%s.csv", job.ShopID, job.Period)
	if _, err := h.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &h.bucket,
		Key:         &key,
		Body:        bytes.NewReader(buf.Bytes()),
		ContentType: aws.String("text/csv"),
	}); err != nil {
		return err
	}

	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.table,
		Item: map[string]types.AttributeValue{
			"pk":          &types.AttributeValueMemberS{Value: "SHOP#" + job.ShopID},
			"sk":          &types.AttributeValueMemberS{Value: "INVOICE#" + job.Period},
			"totalCents":  &types.AttributeValueMemberN{Value: strconv.FormatInt(int64(total*100), 10)},
			"lineCount":   &types.AttributeValueMemberN{Value: strconv.Itoa(len(items))},
			"documentKey": &types.AttributeValueMemberS{Value: key},
		},
	})
	return err
}

func (h handler) handle(ctx context.Context, e events.SQSEvent) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse
	for _, record := range e.Records {
		var job invoiceJob
		err := json.Unmarshal([]byte(record.Body), &job)
		if err == nil {
			err = h.invoice(ctx, job)
		}
		if err != nil {
			slog.Error("build invoice", "messageId", record.MessageId, "err", err)
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
	lambda.Start(handler{
		db:     dynamodb.NewFromConfig(cfg),
		s3:     s3.NewFromConfig(cfg),
		table:  os.Getenv("BILLING_TABLE"),
		bucket: os.Getenv("INVOICE_BUCKET"),
	}.handle)
}
