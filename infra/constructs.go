package infra

import (
	"fmt"
	"path/filepath"
	"runtime"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscloudwatch"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscloudwatchactions"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslogs"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssqs"
	"github.com/aws/aws-cdk-go/awscdklambdagoalpha/v2"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

// moduleRoot resolves Lambda entry paths from the repo root, so synth works
// from `cdk` (repo root) and from `go test ./infra` (infra/) alike.
var moduleRoot = func() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..")
}()

type FunctionProps struct {
	Entry       string // relative to the repo root, e.g. services/orders/createorder
	Environment map[string]*string
	Timeout     float64 // seconds
	AlarmTopic  awssns.ITopic
}

// NewGoFunction applies the house defaults: arm64, explicit timeout, JSON
// logs with retention, and an Errors alarm wired to the ops topic.
func NewGoFunction(scope constructs.Construct, id string, p FunctionProps) awslambda.Function {
	logs := awslogs.NewLogGroup(scope, jsii.String(id+"Logs"), &awslogs.LogGroupProps{
		Retention:     awslogs.RetentionDays_ONE_MONTH,
		RemovalPolicy: awscdk.RemovalPolicy_DESTROY,
	})

	fn := awscdklambdagoalpha.NewGoFunction(scope, jsii.String(id), &awscdklambdagoalpha.GoFunctionProps{
		Entry:         jsii.String(filepath.Join(moduleRoot, p.Entry)),
		Runtime:       awslambda.Runtime_PROVIDED_AL2023(),
		Architecture:  awslambda.Architecture_ARM_64(),
		Timeout:       awscdk.Duration_Seconds(jsii.Number(p.Timeout)),
		MemorySize:    jsii.Number(256),
		Environment:   &p.Environment,
		LoggingFormat: awslambda.LoggingFormat_JSON,
		LogGroup:      logs,
		Tracing:       awslambda.Tracing_ACTIVE,
	})

	alarm := fn.MetricErrors(&awscloudwatch.MetricOptions{
		Period: awscdk.Duration_Minutes(jsii.Number(5)),
	}).CreateAlarm(scope, jsii.String(id+"ErrorsAlarm"), &awscloudwatch.CreateAlarmOptions{
		Threshold:         jsii.Number(1),
		EvaluationPeriods: jsii.Number(1),
		TreatMissingData:  awscloudwatch.TreatMissingData_NOT_BREACHING,
	})
	alarm.AddAlarmAction(awscloudwatchactions.NewSnsAction(p.AlarmTopic))

	return fn
}

type QueueProps struct {
	VisibilityTimeout awscdk.Duration
	AlarmTopic        awssns.ITopic
}

type QueueWithDLQ struct {
	Queue      awssqs.Queue
	DeadLetter awssqs.Queue
}

// NewQueueWithDLQ creates a work queue whose poison messages land in a DLQ
// that pages the ops topic as soon as anything arrives.
func NewQueueWithDLQ(scope constructs.Construct, id string, p QueueProps) QueueWithDLQ {
	dlq := awssqs.NewQueue(scope, jsii.String(id+"DLQ"), &awssqs.QueueProps{
		RetentionPeriod: awscdk.Duration_Days(jsii.Number(14)),
		EnforceSSL:      jsii.Bool(true),
	})
	queue := awssqs.NewQueue(scope, jsii.String(id), &awssqs.QueueProps{
		VisibilityTimeout: p.VisibilityTimeout,
		EnforceSSL:        jsii.Bool(true),
		DeadLetterQueue: &awssqs.DeadLetterQueue{
			Queue:           dlq,
			MaxReceiveCount: jsii.Number(5),
		},
	})

	alarm := dlq.MetricApproximateNumberOfMessagesVisible(&awscloudwatch.MetricOptions{
		Period: awscdk.Duration_Minutes(jsii.Number(1)),
	}).CreateAlarm(scope, jsii.String(id+"DLQAlarm"), &awscloudwatch.CreateAlarmOptions{
		Threshold:          jsii.Number(0),
		ComparisonOperator: awscloudwatch.ComparisonOperator_GREATER_THAN_THRESHOLD,
		EvaluationPeriods:  jsii.Number(1),
		TreatMissingData:   awscloudwatch.TreatMissingData_NOT_BREACHING,
	})
	alarm.AddAlarmAction(awscloudwatchactions.NewSnsAction(p.AlarmTopic))

	return QueueWithDLQ{Queue: queue, DeadLetter: dlq}
}

// NewSingleTable is the per-context table: generic pk/sk, on-demand, PITR,
// retained on stack deletion. ttlAttribute may be empty.
func NewSingleTable(scope constructs.Construct, id string, ttlAttribute string) awsdynamodb.Table {
	props := &awsdynamodb.TableProps{
		PartitionKey: &awsdynamodb.Attribute{Name: jsii.String("pk"), Type: awsdynamodb.AttributeType_STRING},
		SortKey:      &awsdynamodb.Attribute{Name: jsii.String("sk"), Type: awsdynamodb.AttributeType_STRING},
		BillingMode:  awsdynamodb.BillingMode_PAY_PER_REQUEST,
		PointInTimeRecoverySpecification: &awsdynamodb.PointInTimeRecoverySpecification{
			PointInTimeRecoveryEnabled: jsii.Bool(true),
		},
		RemovalPolicy: awscdk.RemovalPolicy_RETAIN,
	}
	if ttlAttribute != "" {
		props.TimeToLiveAttribute = jsii.String(ttlAttribute)
	}
	return awsdynamodb.NewTable(scope, jsii.String(id), props)
}

type ServiceAPI struct {
	API    awsapigateway.RestApi
	Authed *awsapigateway.MethodOptions
}

// NewServiceAPI gives each bounded context its own REST API, guarded by the
// shared Cognito user pool.
func NewServiceAPI(scope constructs.Construct, id string, pool awscognito.IUserPool) ServiceAPI {
	accessLogs := awslogs.NewLogGroup(scope, jsii.String(id+"AccessLogs"), &awslogs.LogGroupProps{
		Retention: awslogs.RetentionDays_THREE_MONTHS,
	})
	api := awsapigateway.NewRestApi(scope, jsii.String(id), &awsapigateway.RestApiProps{
		DeployOptions: &awsapigateway.StageOptions{
			StageName:            jsii.String("v1"),
			TracingEnabled:       jsii.Bool(true),
			ThrottlingRateLimit:  jsii.Number(50),
			ThrottlingBurstLimit: jsii.Number(100),
			AccessLogDestination: awsapigateway.NewLogGroupLogDestination(accessLogs),
			AccessLogFormat:      awsapigateway.AccessLogFormat_Clf(),
		},
	})
	authorizer := awsapigateway.NewCognitoUserPoolsAuthorizer(scope, jsii.String(id+"Authorizer"), &awsapigateway.CognitoUserPoolsAuthorizerProps{
		CognitoUserPools: &[]awscognito.IUserPool{pool},
	})
	return ServiceAPI{
		API: api,
		Authed: &awsapigateway.MethodOptions{
			Authorizer:        authorizer,
			AuthorizationType: awsapigateway.AuthorizationType_COGNITO,
		},
	}
}

// grantSendEmailFrom lets fn send SES email as sender. In the SES sandbox
// the recipient is a verified identity too, and SES authorises against
// both, so scope by sender address rather than by a single identity ARN.
func grantSendEmailFrom(stack awscdk.Stack, fn awslambda.IFunction, sender string) {
	fn.AddToRolePolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Actions:   jsii.Strings("ses:SendEmail"),
		Resources: jsii.Strings(fmt.Sprintf("arn:%s:ses:%s:%s:identity/*", *stack.Partition(), *stack.Region(), *stack.Account())),
		Conditions: &map[string]any{
			"StringEquals": map[string]any{"ses:FromAddress": sender},
		},
	}))
}

func tag(stack awscdk.Stack, context string) {
	awscdk.Tags_Of(stack).Add(jsii.String("context"), jsii.String(context), nil)
	awscdk.Tags_Of(stack).Add(jsii.String("app"), jsii.String("dis-patchy"), nil)
}
