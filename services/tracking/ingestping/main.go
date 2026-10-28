// Command ingestping accepts location pings from the driver app and puts
// them on the Kinesis stream, partitioned by driver.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/MattJColes/dis-patchy/services/tracking"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kinesis"
)

type handler struct {
	kinesis *kinesis.Client
	stream  string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if !shared.InGroup(req, "drivers") {
		return shared.Error(http.StatusForbidden, "drivers only")
	}

	var ping tracking.Ping
	_ = json.Unmarshal([]byte(req.Body), &ping)
	ping.DriverID = shared.UserID(req)
	if ping.RecordedAt.IsZero() {
		ping.RecordedAt = time.Now().UTC()
	}

	data, err := json.Marshal(ping)
	if err != nil {
		return shared.Internal(err)
	}
	if _, err := h.kinesis.PutRecord(ctx, &kinesis.PutRecordInput{
		StreamName:   &h.stream,
		PartitionKey: &ping.DriverID,
		Data:         data,
	}); err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusAccepted, map[string]string{"status": "accepted"})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{kinesis: kinesis.NewFromConfig(cfg), stream: os.Getenv("STREAM_NAME")}.handle)
}
