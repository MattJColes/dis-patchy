package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awskinesis"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambdaeventsources"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type TrackingStackProps struct {
	awscdk.StackProps
	UserPool    awscognito.IUserPool
	AlarmTopic  awssns.ITopic
	OrdersTable awsdynamodb.ITable
}

// TrackingStack ingests driver location pings through Kinesis and serves
// customer ETAs from the latest known position.
type TrackingStack struct {
	awscdk.Stack
}

func NewTrackingStack(scope constructs.Construct, id string, props *TrackingStackProps) *TrackingStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "tracking")

	stream := awskinesis.NewStream(stack, jsii.String("DriverPings"), &awskinesis.StreamProps{
		StreamMode:      awskinesis.StreamMode_PROVISIONED,
		ShardCount:      jsii.Number(1),
		Encryption:      awskinesis.StreamEncryption_MANAGED,
		RetentionPeriod: awscdk.Duration_Hours(jsii.Number(24)),
	})

	positions := NewSingleTable(stack, "Positions", "expiresAt")

	ingest := NewGoFunction(stack, "IngestPing", FunctionProps{
		Entry:       "services/tracking/ingestping",
		Timeout:     5,
		Environment: map[string]*string{"STREAM_NAME": stream.StreamName()},
		AlarmTopic:  props.AlarmTopic,
	})
	stream.GrantWrite(ingest)

	consumer := NewGoFunction(stack, "UpdatePositions", FunctionProps{
		Entry:       "services/tracking/positions",
		Timeout:     30,
		Environment: map[string]*string{"POSITIONS_TABLE": positions.TableName()},
		AlarmTopic:  props.AlarmTopic,
	})
	positions.GrantWriteData(consumer)
	consumer.AddEventSource(awslambdaeventsources.NewKinesisEventSource(stream, &awslambdaeventsources.KinesisEventSourceProps{
		StartingPosition:  awslambda.StartingPosition_LATEST,
		BatchSize:         jsii.Number(100),
		MaxBatchingWindow: awscdk.Duration_Seconds(jsii.Number(5)),
	}))

	eta := NewGoFunction(stack, "OrderEta", FunctionProps{
		Entry:   "services/tracking/eta",
		Timeout: 5,
		Environment: map[string]*string{
			"ORDERS_TABLE":    props.OrdersTable.TableName(),
			"POSITIONS_TABLE": positions.TableName(),
		},
		AlarmTopic: props.AlarmTopic,
	})
	props.OrdersTable.GrantReadData(eta)
	positions.GrantReadData(eta)

	api := NewServiceAPI(stack, "TrackingApi", props.UserPool)
	api.API.Root().AddResource(jsii.String("pings"), nil).
		AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(ingest, nil), api.Authed)
	api.API.Root().AddResource(jsii.String("orders"), nil).
		AddResource(jsii.String("{orderId}"), nil).
		AddResource(jsii.String("eta"), nil).
		AddMethod(jsii.String("GET"), awsapigateway.NewLambdaIntegration(eta, nil), api.Authed)

	return &TrackingStack{Stack: stack}
}
