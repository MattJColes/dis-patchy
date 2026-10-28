package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"os"
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
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sestypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/google/uuid"
)

// Idempotency records outlive any sane client retry window.
const idempotencyTTL = 24 * time.Hour

type createOrderRequest struct {
	CustomerName   string `json:"customerName"`
	CustomerEmail  string `json:"customerEmail"`
	DropoffAddress string `json:"dropoffAddress"`
}

func validEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Address == s
}

func (r createOrderRequest) validate() error {
	switch {
	case strings.TrimSpace(r.CustomerName) == "":
		return fmt.Errorf("customerName is required")
	case !validEmail(r.CustomerEmail):
		return fmt.Errorf("customerEmail must be a valid email address")
	case strings.TrimSpace(r.DropoffAddress) == "":
		return fmt.Errorf("dropoffAddress is required")
	}
	return nil
}

type handler struct {
	db          *dynamodb.Client
	events      *eventbridge.Client
	ses         *sesv2.Client
	sender      string
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
	defer func() { _ = resp.Body.Close() }()
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

func header(req events.APIGatewayProxyRequest, name string) string {
	for k, v := range req.Headers {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}

func idempotencyKey(shopID, key string) map[string]dbtypes.AttributeValue {
	return map[string]dbtypes.AttributeValue{
		"pk": &dbtypes.AttributeValueMemberS{Value: "IDEMPOTENCY#" + shopID + "#" + key},
		"sk": &dbtypes.AttributeValueMemberS{Value: "META"},
	}
}

// previousOrder returns the order already created for this key, or "".
func (h handler) previousOrder(ctx context.Context, shopID, key string) (string, error) {
	out, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{TableName: &h.table, Key: idempotencyKey(shopID, key)})
	if err != nil || out.Item == nil {
		return "", err
	}
	id, _ := out.Item["orderId"].(*dbtypes.AttributeValueMemberS)
	if id == nil {
		return "", nil
	}
	return id.Value, nil
}

func (h handler) rememberOrder(ctx context.Context, shopID, key, orderID string) error {
	item := idempotencyKey(shopID, key)
	item["orderId"] = &dbtypes.AttributeValueMemberS{Value: orderID}
	item["expiresAt"] = &dbtypes.AttributeValueMemberN{Value: fmt.Sprint(time.Now().Add(idempotencyTTL).Unix())}
	_, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &h.table, Item: item})
	return err
}

func (h handler) sendConfirmation(ctx context.Context, order orders.Order) error {
	_, err := h.ses.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: &h.sender,
		Destination:      &sestypes.Destination{ToAddresses: []string{order.CustomerEmail}},
		Content: &sestypes.EmailContent{Simple: &sestypes.Message{
			Subject: &sestypes.Content{Data: aws.String("We've got your order")},
			Body: &sestypes.Body{Text: &sestypes.Content{Data: aws.String(fmt.Sprintf(
				"Hi %s,\n\nYour delivery to %s is booked. We'll email you when a driver picks it up.\n\n- dis-patchy",
				order.CustomerName, order.DropoffAddress))}},
		}},
	})
	return err
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	shopID := shared.ShopID(req)
	if shopID == "" {
		return shared.Error(http.StatusForbidden, "caller is not linked to a shop")
	}

	// Clients send Idempotency-Key so a retried request returns the
	// original order instead of creating another.
	idemKey := header(req, "Idempotency-Key")
	if idemKey != "" {
		previous, err := h.previousOrder(ctx, shopID, idemKey)
		if err != nil {
			return shared.Internal(err)
		}
		if previous != "" {
			return shared.JSON(http.StatusOK, map[string]string{"orderId": previous})
		}
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
		CustomerEmail:  body.CustomerEmail,
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

	if err := h.sendConfirmation(ctx, order); err != nil {
		return shared.Internal(fmt.Errorf("send confirmation: %w", err))
	}

	if idemKey != "" {
		if err := h.rememberOrder(ctx, shopID, idemKey, order.OrderID); err != nil {
			// The order exists; failing the request now would invite a retry.
			slog.Warn("store idempotency key", "orderId", order.OrderID, "err", err)
		}
	}

	return shared.JSON(http.StatusCreated, order)
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	key, err := ssm.NewFromConfig(cfg).GetParameter(context.Background(), &ssm.GetParameterInput{
		Name:           aws.String(os.Getenv("GEOCODER_KEY_PARAM")),
		WithDecryption: aws.Bool(true),
	})
	if err != nil {
		panic("read geocoder key: " + err.Error())
	}
	lambda.Start(handler{
		db:          dynamodb.NewFromConfig(cfg),
		events:      eventbridge.NewFromConfig(cfg),
		ses:         sesv2.NewFromConfig(cfg),
		sender:      os.Getenv("SENDER_EMAIL"),
		table:       os.Getenv("TABLE_NAME"),
		bus:         os.Getenv("BUS_NAME"),
		geocoderURL: os.Getenv("GEOCODER_URL"),
		geocoderKey: aws.ToString(key.Parameter.Value),
	}.handle)
}
