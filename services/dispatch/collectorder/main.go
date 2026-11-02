// Command collectorder records the assigned driver's collection of a parcel.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
)

type handler struct {
	db     *dynamodb.Client
	events *eventbridge.Client
	table  string
	bus    string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	driverID := shared.UserID(req)
	if !shared.InGroup(req, "drivers") || driverID == "" {
		return shared.Error(http.StatusForbidden, "drivers only")
	}
	orderID := req.PathParameters["orderId"]
	if orderID == "" {
		return shared.Error(http.StatusBadRequest, "orderId is required")
	}
	pk, sk := orders.Key(orderID)
	key := map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: pk}, "sk": &types.AttributeValueMemberS{Value: sk},
	}
	current, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{TableName: &h.table, Key: key, ConsistentRead: aws.Bool(true)})
	if err != nil {
		return shared.Internal(err)
	}
	var order orders.Order
	if err := attributevalue.UnmarshalMap(current.Item, &order); err != nil {
		return shared.Internal(err)
	}
	if order.OrderID == "" || order.DriverID != driverID {
		return shared.Error(http.StatusNotFound, "order not found")
	}
	out, err := h.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &h.table, Key: key,
		ConditionExpression:      aws.String("#status = :assigned AND driverId = :driver"),
		UpdateExpression:         aws.String("SET collectedAt = if_not_exists(collectedAt, :at)"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":assigned": &types.AttributeValueMemberS{Value: string(orders.StatusAssigned)},
			":driver":   &types.AttributeValueMemberS{Value: driverID},
			":at":       &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339Nano)},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	var changed *types.ConditionalCheckFailedException
	if errors.As(err, &changed) {
		return shared.Error(http.StatusConflict, "order is no longer assigned to this driver")
	}
	if err != nil {
		return shared.Internal(err)
	}
	if err := attributevalue.UnmarshalMap(out.Attributes, &order); err != nil {
		return shared.Internal(err)
	}
	if order.CollectedAt == nil {
		return shared.Internal(errors.New("collection write returned no timestamp"))
	}
	if err := shared.PublishEvent(ctx, h.events, h.bus, "dispatchy.dispatch", "OrderCollected", map[string]any{
		"orderId": orderID, "driverId": driverID, "shopId": order.ShopID, "collectedAt": order.CollectedAt,
	}); err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusOK, map[string]any{"orderId": orderID, "collectedAt": order.CollectedAt})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		db: dynamodb.NewFromConfig(cfg), events: eventbridge.NewFromConfig(cfg),
		table: os.Getenv("ORDERS_TABLE"), bus: os.Getenv("BUS_NAME"),
	}.handle)
}
