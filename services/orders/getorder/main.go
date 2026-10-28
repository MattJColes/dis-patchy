package main

import (
	"context"
	"net/http"
	"os"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type handler struct {
	db    *dynamodb.Client
	table string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	orderID := req.PathParameters["orderId"]
	if orderID == "" {
		return shared.Error(http.StatusBadRequest, "orderId is required")
	}

	pk, sk := orders.Key(orderID)
	out, err := h.db.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: &h.table,
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: sk},
		},
	})
	if err != nil {
		return shared.Internal(err)
	}
	if out.Item == nil {
		return shared.Error(http.StatusNotFound, "order not found")
	}

	var order orders.Order
	if err := attributevalue.UnmarshalMap(out.Item, &order); err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusOK, order)
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{db: dynamodb.NewFromConfig(cfg), table: os.Getenv("TABLE_NAME")}.handle)
}
