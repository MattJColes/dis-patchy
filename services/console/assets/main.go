package main

import (
	"context"
	"net/http"
	"os"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/MattJColes/dis-patchy/services/shared"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type handler struct {
	db           *dynamodb.Client
	table        string
	driversTable string
}

func (h handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if !shared.InGroup(req, "ops") {
		return shared.Error(http.StatusForbidden, "ops only")
	}
	fleet, err := console.ReadFleet(ctx, h.db, h.table, h.driversTable)
	if err != nil {
		return shared.Internal(err)
	}
	return shared.JSON(http.StatusOK, fleet)
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{db: dynamodb.NewFromConfig(cfg), table: os.Getenv("CONSOLE_TABLE"), driversTable: os.Getenv("DRIVERS_TABLE")}.handle)
}
