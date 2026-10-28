// Command positions consumes the ping stream and keeps each driver's latest
// position in DynamoDB.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/MattJColes/dis-patchy/services/tracking"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Positions older than this are useless for ETAs; TTL cleans them up.
const positionTTL = 6 * time.Hour

type handler struct {
	db    *dynamodb.Client
	table string
}

func (h handler) handle(ctx context.Context, e events.KinesisEvent) error {
	for _, record := range e.Records {
		var ping tracking.Ping
		if err := json.Unmarshal(record.Kinesis.Data, &ping); err != nil {
			return fmt.Errorf("decode %s: %w", record.EventID, err)
		}

		pos := tracking.Position{
			Lat:        ping.Lat,
			Lng:        ping.Lng,
			RecordedAt: ping.RecordedAt,
			ExpiresAt:  ping.RecordedAt.Add(positionTTL).Unix(),
		}
		pos.PK, pos.SK = tracking.PositionKey(ping.DriverID)

		item, err := attributevalue.MarshalMap(pos)
		if err != nil {
			return err
		}
		if _, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &h.table, Item: item}); err != nil {
			return fmt.Errorf("store position for %s: %w", ping.DriverID, err)
		}
	}
	return nil
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{db: dynamodb.NewFromConfig(cfg), table: os.Getenv("POSITIONS_TABLE")}.handle)
}
