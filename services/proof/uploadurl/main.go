// Command uploadurl hands the assigned driver a presigned URL for the
// proof-of-delivery photo.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/orders"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

const urlLifetime = 15 * time.Minute

var extensions = map[string]string{"image/jpeg": ".jpg", "image/png": ".png"}

type handler struct {
	presign *s3.PresignClient
	db      *dynamodb.Client
	bucket  string
	table   string
}

func (h handler) order(ctx context.Context, orderID string) (*orders.Order, error) {
	pk, sk := orders.Key(orderID)
	out, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &h.table,
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: sk},
		},
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var o orders.Order
	return &o, attributevalue.UnmarshalMap(out.Item, &o)
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if !shared.InGroup(req, "drivers") {
		return shared.Error(http.StatusForbidden, "drivers only")
	}
	orderID := req.PathParameters["orderId"]

	var body struct {
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return shared.Error(http.StatusBadRequest, "invalid JSON body")
	}
	ext, ok := extensions[body.ContentType]
	if !ok {
		return shared.Error(http.StatusBadRequest, "contentType must be image/jpeg or image/png")
	}

	order, err := h.order(ctx, orderID)
	if err != nil {
		return shared.Internal(err)
	}
	if order == nil || order.DriverID != shared.UserID(req) {
		return shared.Error(http.StatusNotFound, "order not found")
	}
	if order.Status != orders.StatusAssigned {
		return shared.Error(http.StatusConflict, "order is not out for delivery")
	}

	// The key is generated here, never taken from the client.
	key := fmt.Sprintf("proof/%s/%s%s", orderID, uuid.NewString(), ext)
	signed, err := h.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      &h.bucket,
		Key:         &key,
		ContentType: &body.ContentType,
	}, s3.WithPresignExpires(urlLifetime))
	if err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusOK, map[string]string{"url": signed.URL, "key": key})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		presign: s3.NewPresignClient(s3.NewFromConfig(cfg)),
		db:      dynamodb.NewFromConfig(cfg),
		bucket:  os.Getenv("BUCKET_NAME"),
		table:   os.Getenv("ORDERS_TABLE"),
	}.handle)
}
