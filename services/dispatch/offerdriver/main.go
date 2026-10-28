// Command offerdriver pushes a job offer to the driver's device. The state
// machine waits on the task token until the driver accepts.
package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
)

type input struct {
	TaskToken string `json:"taskToken"`
	OrderID   string `json:"orderId"`
	DriverID  string `json:"driverId"`
}

type handler struct {
	sns   *sns.Client
	topic string
}

func (h handler) handle(ctx context.Context, in input) error {
	msg, err := json.Marshal(map[string]string{"orderId": in.OrderID, "taskToken": in.TaskToken})
	if err != nil {
		return err
	}
	// Driver apps subscribe with a filter policy on driverId.
	_, err = h.sns.Publish(ctx, &sns.PublishInput{
		TopicArn: &h.topic,
		Message:  aws.String(string(msg)),
		MessageAttributes: map[string]types.MessageAttributeValue{
			"driverId": {DataType: aws.String("String"), StringValue: &in.DriverID},
		},
	})
	return err
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	lambda.Start(handler{sns: sns.NewFromConfig(cfg), topic: os.Getenv("OFFERS_TOPIC_ARN")}.handle)
}
