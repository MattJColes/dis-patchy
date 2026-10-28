// Command acceptoffer resumes the waiting dispatch execution when a driver
// accepts a job.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	sfntypes "github.com/aws/aws-sdk-go-v2/service/sfn/types"
)

type handler struct {
	sfn   *sfn.Client
	db    *dynamodb.Client
	table string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if !shared.InGroup(req, "drivers") {
		return shared.Error(http.StatusForbidden, "drivers only")
	}
	driverID := shared.UserID(req)

	var body struct {
		TaskToken string `json:"taskToken"`
	}
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil || body.TaskToken == "" {
		return shared.Error(http.StatusBadRequest, "taskToken is required")
	}

	output, err := json.Marshal(map[string]string{"driverId": driverID})
	if err != nil {
		return shared.Internal(err)
	}
	_, err = h.sfn.SendTaskSuccess(ctx, &sfn.SendTaskSuccessInput{
		TaskToken: &body.TaskToken,
		Output:    aws.String(string(output)),
	})
	var expired *sfntypes.TaskTimedOut
	var invalid *sfntypes.InvalidToken
	switch {
	case errors.As(err, &expired), errors.As(err, &invalid):
		return shared.Error(http.StatusGone, "offer is no longer available")
	case err != nil:
		return shared.Internal(err)
	}

	_, err = h.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &h.table,
		Key: map[string]dbtypes.AttributeValue{
			"pk": &dbtypes.AttributeValueMemberS{Value: "DRIVER#" + driverID},
			"sk": &dbtypes.AttributeValueMemberS{Value: "PROFILE"},
		},
		UpdateExpression:         aws.String("SET #status = :busy"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":busy": &dbtypes.AttributeValueMemberS{Value: "BUSY"},
		},
	})
	if err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusOK, map[string]string{"status": "accepted"})
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{
		sfn:   sfn.NewFromConfig(cfg),
		db:    dynamodb.NewFromConfig(cfg),
		table: os.Getenv("DRIVERS_TABLE"),
	}.handle)
}
