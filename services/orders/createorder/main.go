package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/google/uuid"
)

var e164 = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

type createOrderRequest struct {
	CustomerName   string `json:"customerName"`
	CustomerPhone  string `json:"customerPhone"`
	DropoffAddress string `json:"dropoffAddress"`
}

func (r createOrderRequest) validate() error {
	switch {
	case strings.TrimSpace(r.CustomerName) == "":
		return fmt.Errorf("customerName is required")
	case !e164.MatchString(r.CustomerPhone):
		return fmt.Errorf("customerPhone must be E.164, e.g. +447700900123")
	case strings.TrimSpace(r.DropoffAddress) == "":
		return fmt.Errorf("dropoffAddress is required")
	}
	return nil
}

type handler struct {
	db          *dynamodb.Client
	events      *eventbridge.Client
	table       string
	bus         string
	geocoderURL string
	geocoderKey string
}

func (h handler) geocode(address string) (lat, lng float64, err error) {
	resp, err := http.Get(fmt.Sprintf("%s?q=%s&key=%s", h.geocoderURL, url.QueryEscape(address), h.geocoderKey))
	if err != nil {
		return 0, 0, fmt.Errorf("geocode: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("geocode: status %d", resp.StatusCode)
	}
	var out struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, 0, fmt.Errorf("geocode: decode: %w", err)
	}
	return out.Lat, out.Lng, nil
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	shopID := shared.ShopID(req)
	if shopID == "" {
		return shared.Error(http.StatusForbidden, "caller is not linked to a shop")
	}

	var body createOrderRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return shared.Error(http.StatusBadRequest, "invalid JSON body")
	}
	if err := body.validate(); err != nil {
		return shared.Error(http.StatusBadRequest, err.Error())
	}

	lat, lng, err := h.geocode(body.DropoffAddress)
	if err != nil {
		return shared.Error(http.StatusUnprocessableEntity, "could not locate dropoff address")
	}

	order := orders.Order{
		OrderID:        uuid.NewString(),
		ShopID:         shopID,
		Status:         orders.StatusPlaced,
		CustomerName:   body.CustomerName,
		CustomerPhone:  body.CustomerPhone,
		DropoffAddress: body.DropoffAddress,
		DropoffLat:     lat,
		DropoffLng:     lng,
		CreatedAt:      time.Now().UTC(),
	}
	order.PK, order.SK = orders.Key(order.OrderID)

	item, err := attributevalue.MarshalMap(order)
	if err != nil {
		return shared.Internal(err)
	}
	if _, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &h.table, Item: item}); err != nil {
		return shared.Internal(err)
	}

	detail, _ := json.Marshal(map[string]string{"orderId": order.OrderID, "shopId": shopID})
	out, err := h.events.PutEvents(ctx, &eventbridge.PutEventsInput{Entries: []ebtypes.PutEventsRequestEntry{{
		EventBusName: &h.bus,
		Source:       aws.String("dispatchy.orders"),
		DetailType:   aws.String("OrderPlaced"),
		Detail:       aws.String(string(detail)),
	}}})
	if err != nil {
		return shared.Internal(err)
	}
	if out.FailedEntryCount > 0 {
		return shared.Internal(fmt.Errorf("OrderPlaced rejected: %s", aws.ToString(out.Entries[0].ErrorMessage)))
	}

	return shared.JSON(http.StatusCreated, order)
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	h := handler{
		db:          dynamodb.NewFromConfig(cfg),
		events:      eventbridge.NewFromConfig(cfg),
		table:       os.Getenv("TABLE_NAME"),
		bus:         os.Getenv("BUS_NAME"),
		geocoderURL: os.Getenv("GEOCODER_URL"),
		geocoderKey: os.Getenv("GEOCODER_API_KEY"),
	}
	lambda.Start(h.handle)
}
