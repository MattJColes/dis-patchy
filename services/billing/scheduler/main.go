// Command scheduler runs on the 1st of each month and queues one invoice
// job per shop for the month that just ended.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type invoiceJob struct {
	ShopID string `json:"shopId"`
	Period string `json:"period"` // YYYY-MM
}

type handler struct {
	db    *dynamodb.Client
	sqs   *sqs.Client
	table string
	queue string
}

func (h handler) handle(ctx context.Context) error {
	now := time.Now().UTC()
	period := fmt.Sprintf("%d-%02d", now.Year(), now.Month()-1)

	pages := dynamodb.NewScanPaginator(h.db, &dynamodb.ScanInput{
		TableName:        &h.table,
		FilterExpression: aws.String("sk = :profile"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":profile": &types.AttributeValueMemberS{Value: "PROFILE"},
		},
		ProjectionExpression: aws.String("pk"),
	})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, item := range page.Items {
			pk := item["pk"].(*types.AttributeValueMemberS).Value
			body, err := json.Marshal(invoiceJob{ShopID: strings.TrimPrefix(pk, "SHOP#"), Period: period})
			if err != nil {
				return err
			}
			if _, err := h.sqs.SendMessage(ctx, &sqs.SendMessageInput{
				QueueUrl:    &h.queue,
				MessageBody: aws.String(string(body)),
			}); err != nil {
				return fmt.Errorf("queue invoice for %s: %w", pk, err)
			}
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
		db:    dynamodb.NewFromConfig(cfg),
		sqs:   sqs.NewFromConfig(cfg),
		table: os.Getenv("BILLING_TABLE"),
		queue: os.Getenv("INVOICE_QUEUE_URL"),
	}.handle)
}
