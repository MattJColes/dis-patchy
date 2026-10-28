// Command uploadurl hands the driver app a presigned URL for the
// proof-of-delivery photo.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const urlLifetime = 15 * time.Minute

var allowedTypes = map[string]bool{"image/jpeg": true, "image/png": true}

type handler struct {
	presign *s3.PresignClient
	bucket  string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	orderID := req.PathParameters["orderId"]

	var body struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil || body.Filename == "" {
		return shared.Error(http.StatusBadRequest, "filename is required")
	}
	if !allowedTypes[body.ContentType] {
		return shared.Error(http.StatusBadRequest, "contentType must be image/jpeg or image/png")
	}

	key := fmt.Sprintf("proof/%s/%s", orderID, body.Filename)
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
		bucket:  os.Getenv("BUCKET_NAME"),
	}.handle)
}
