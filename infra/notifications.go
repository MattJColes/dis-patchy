package infra

import (
	"fmt"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awseventstargets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambdaeventsources"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsses"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type NotificationsStackProps struct {
	awscdk.StackProps
	Bus         awsevents.IEventBus
	AlarmTopic  awssns.ITopic
	OrdersTable awsdynamodb.ITable
	SenderEmail string
}

// NotificationsStack emails customers as their order progresses, driven
// entirely by events on the bus.
type NotificationsStack struct {
	awscdk.Stack
}

func NewNotificationsStack(scope constructs.Construct, id string, props *NotificationsStackProps) *NotificationsStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "notifications")

	awsses.NewEmailIdentity(stack, jsii.String("Sender"), &awsses.EmailIdentityProps{
		Identity: awsses.Identity_Email(jsii.String(props.SenderEmail)),
	})

	inbox := NewQueueWithDLQ(stack, "Notifications", QueueProps{
		VisibilityTimeout: awscdk.Duration_Seconds(jsii.Number(60)),
		AlarmTopic:        props.AlarmTopic,
	})
	awsevents.NewRule(stack, jsii.String("CustomerUpdatesRule"), &awsevents.RuleProps{
		EventBus: props.Bus,
		EventPattern: &awsevents.EventPattern{
			Source:     jsii.Strings(SourceDispatch, SourceProof),
			DetailType: jsii.Strings("DriverAssigned", "OrderDelivered"),
		},
		Targets: &[]awsevents.IRuleTarget{awseventstargets.NewSqsQueue(inbox.Queue, nil)},
	})

	notifier := NewGoFunction(stack, "NotifyCustomer", FunctionProps{
		Entry:   "services/notifications/notifier",
		Timeout: 15,
		Environment: map[string]*string{
			"ORDERS_TABLE": props.OrdersTable.TableName(),
			"SENDER_EMAIL": jsii.String(props.SenderEmail),
		},
		AlarmTopic: props.AlarmTopic,
	})
	props.OrdersTable.GrantReadData(notifier)
	// In the SES sandbox the recipient is a verified identity too, and SES
	// authorises against both, so scope by sender address rather than by a
	// single identity ARN.
	notifier.AddToRolePolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Actions:   jsii.Strings("ses:SendEmail"),
		Resources: jsii.Strings(fmt.Sprintf("arn:%s:ses:%s:%s:identity/*", *stack.Partition(), *stack.Region(), *stack.Account())),
		Conditions: &map[string]any{
			"StringEquals": map[string]any{"ses:FromAddress": props.SenderEmail},
		},
	}))
	notifier.AddEventSource(awslambdaeventsources.NewSqsEventSource(inbox.Queue, &awslambdaeventsources.SqsEventSourceProps{
		BatchSize:               jsii.Number(10),
		ReportBatchItemFailures: jsii.Bool(true),
	}))

	return &NotificationsStack{Stack: stack}
}
