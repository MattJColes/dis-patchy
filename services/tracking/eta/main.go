// Command eta tells a customer how far away their driver is.
package main

import (
	"context"
	"math"
	"net/http"
	"os"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/MattJColes/dis-patchy/services/tracking"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const (
	earthRadiusKm  = 6371.0
	avgCitySpeedKm = 25.0
)

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(a))
}

type handler struct {
	db             *dynamodb.Client
	ordersTable    string
	positionsTable string
}

func (h handler) get(ctx context.Context, table, pk, sk string, out any) (bool, error) {
	res, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: sk},
		},
	})
	if err != nil || res.Item == nil {
		return false, err
	}
	return true, attributevalue.UnmarshalMap(res.Item, out)
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var order orders.Order
	pk, sk := orders.Key(req.PathParameters["orderId"])
	found, err := h.get(ctx, h.ordersTable, pk, sk, &order)
	if err != nil {
		return shared.Internal(err)
	}
	if !found {
		return shared.Error(http.StatusNotFound, "order not found")
	}
	if order.Status != orders.StatusAssigned {
		return shared.Error(http.StatusConflict, "order is not out for delivery")
	}

	var pos tracking.Position
	pk, sk = tracking.PositionKey(order.DriverID)
	found, err = h.get(ctx, h.positionsTable, pk, sk, &pos)
	if err != nil {
		return shared.Internal(err)
	}
	if !found {
		return shared.Error(http.StatusServiceUnavailable, "driver location unknown")
	}

	km := haversineKm(pos.Lat, pos.Lng, order.DropoffLat, order.DropoffLng)
	return shared.JSON(http.StatusOK, map[string]any{
		"etaMinutes": math.Ceil(km / avgCitySpeedKm * 60),
		"driverLat":  pos.Lat,
		"driverLng":  pos.Lng,
		"asOf":       pos.RecordedAt,
	})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		db:             dynamodb.NewFromConfig(cfg),
		ordersTable:    os.Getenv("ORDERS_TABLE"),
		positionsTable: os.Getenv("POSITIONS_TABLE"),
	}.handle)
}
