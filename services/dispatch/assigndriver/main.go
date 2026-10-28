// Command assigndriver claims an available driver for an order. It is the
// first step of the dispatch state machine.
package main

import (
	"context"
	"errors"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const availableKey = "STATUS#AVAILABLE"

// NoDriverAvailable is matched by name in the state machine's Retry block.
type NoDriverAvailable struct{}

func (NoDriverAvailable) Error() string { return "no driver available" }

type input struct {
	OrderID string `json:"orderId"`
}

type output struct {
	DriverID string `json:"driverId"`
}

type handler struct {
	db    *dynamodb.Client
	table string
}

func (h handler) handle(ctx context.Context, in input) (output, error) {
	candidates, err := h.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &h.table,
		IndexName:              aws.String("byStatus"),
		KeyConditionExpression: aws.String("gsi1pk = :available"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":available": &types.AttributeValueMemberS{Value: availableKey},
		},
		Limit: aws.Int32(5),
	})
	if err != nil {
		return output{}, err
	}

	for _, item := range candidates.Items {
		driverID := item["gsi1sk"].(*types.AttributeValueMemberS).Value

		// Two dispatches can race for the same driver; the condition lets
		// exactly one of them win.
		_, err := h.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &h.table,
			Key: map[string]types.AttributeValue{
				"pk": &types.AttributeValueMemberS{Value: "DRIVER#" + driverID},
				"sk": &types.AttributeValueMemberS{Value: "PROFILE"},
			},
			ConditionExpression: aws.String("gsi1pk = :available"),
			UpdateExpression:    aws.String("SET #status = :offered, offeredOrderId = :order REMOVE gsi1pk, gsi1sk"),
			ExpressionAttributeNames: map[string]string{
				"#status": "status",
			},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":available": &types.AttributeValueMemberS{Value: availableKey},
				":offered":   &types.AttributeValueMemberS{Value: "OFFERED"},
				":order":     &types.AttributeValueMemberS{Value: in.OrderID},
			},
		})
		var lost *types.ConditionalCheckFailedException
		if errors.As(err, &lost) {
			continue
		}
		if err != nil {
			return output{}, err
		}
		return output{DriverID: driverID}, nil
	}
	return output{}, NoDriverAvailable{}
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{db: dynamodb.NewFromConfig(cfg), table: os.Getenv("DRIVERS_TABLE")}.handle)
}
