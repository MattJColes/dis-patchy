package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awseventstargets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambdaeventsources"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssqs"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type BillingStackProps struct {
	awscdk.StackProps
	Bus        awsevents.IEventBus
	AlarmTopic awssns.ITopic
}

// BillingStack records a line item per delivered order and produces a
// monthly CSV invoice per shop.
type BillingStack struct {
	awscdk.Stack
}

func NewBillingStack(scope constructs.Construct, id string, props *BillingStackProps) *BillingStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "billing")

	table := awsdynamodb.NewTable(stack, jsii.String("Billing"), &awsdynamodb.TableProps{
		PartitionKey: &awsdynamodb.Attribute{Name: jsii.String("pk"), Type: awsdynamodb.AttributeType_STRING},
		SortKey:      &awsdynamodb.Attribute{Name: jsii.String("sk"), Type: awsdynamodb.AttributeType_STRING},
		BillingMode:  awsdynamodb.BillingMode_PAY_PER_REQUEST,
		PointInTimeRecoverySpecification: &awsdynamodb.PointInTimeRecoverySpecification{
			PointInTimeRecoveryEnabled: jsii.Bool(true),
		},
		RemovalPolicy: awscdk.RemovalPolicy_DESTROY,
	})

	invoices := awss3.NewBucket(stack, jsii.String("Invoices"), &awss3.BucketProps{
		BlockPublicAccess: awss3.BlockPublicAccess_BLOCK_ALL(),
		Encryption:        awss3.BucketEncryption_S3_MANAGED,
		EnforceSSL:        jsii.Bool(true),
		Versioned:         jsii.Bool(true),
		RemovalPolicy:     awscdk.RemovalPolicy_RETAIN,
	})

	// Delivered orders -> line items.
	deliveredDLQ := awssqs.NewQueue(stack, jsii.String("DeliveredDLQ"), &awssqs.QueueProps{
		RetentionPeriod: awscdk.Duration_Days(jsii.Number(14)),
		EnforceSSL:      jsii.Bool(true),
	})
	delivered := awssqs.NewQueue(stack, jsii.String("Delivered"), &awssqs.QueueProps{
		VisibilityTimeout: awscdk.Duration_Seconds(jsii.Number(60)),
		EnforceSSL:        jsii.Bool(true),
		DeadLetterQueue:   &awssqs.DeadLetterQueue{Queue: deliveredDLQ, MaxReceiveCount: jsii.Number(5)},
	})
	awsevents.NewRule(stack, jsii.String("OrderDeliveredRule"), &awsevents.RuleProps{
		EventBus: props.Bus,
		EventPattern: &awsevents.EventPattern{
			Source:     jsii.Strings("dispatchy.pod"),
			DetailType: jsii.Strings("OrderDelivered"),
		},
		Targets: &[]awsevents.IRuleTarget{awseventstargets.NewSqsQueue(delivered, nil)},
	})

	recorder := NewGoFunction(stack, "RecordLineItem", FunctionProps{
		Entry:   "services/billing/recorder",
		Timeout: 10,
		Environment: map[string]*string{
			"BILLING_TABLE": table.TableName(),
			"DELIVERY_FEE":  jsii.String("4.99"),
		},
		AlarmTopic: props.AlarmTopic,
	})
	table.GrantWriteData(recorder)
	recorder.AddEventSource(awslambdaeventsources.NewSqsEventSource(delivered, &awslambdaeventsources.SqsEventSourceProps{
		BatchSize:               jsii.Number(10),
		ReportBatchItemFailures: jsii.Bool(true),
	}))

	// Monthly run -> one invoice job per shop.
	jobs := NewQueueWithDLQ(stack, "InvoiceJobs", QueueProps{
		VisibilityTimeout: awscdk.Duration_Minutes(jsii.Number(5)),
		AlarmTopic:        props.AlarmTopic,
	})

	scheduler := NewGoFunction(stack, "ScheduleInvoices", FunctionProps{
		Entry:   "services/billing/scheduler",
		Timeout: 120,
		Environment: map[string]*string{
			"BILLING_TABLE":     table.TableName(),
			"INVOICE_QUEUE_URL": jobs.Queue.QueueUrl(),
		},
		AlarmTopic: props.AlarmTopic,
	})
	table.GrantReadData(scheduler)
	jobs.Queue.GrantSendMessages(scheduler)
	awsevents.NewRule(stack, jsii.String("MonthlyInvoiceRun"), &awsevents.RuleProps{
		Schedule: awsevents.Schedule_Cron(&awsevents.CronOptions{
			Minute: jsii.String("0"),
			Hour:   jsii.String("2"),
			Day:    jsii.String("1"),
		}),
		Targets: &[]awsevents.IRuleTarget{awseventstargets.NewLambdaFunction(scheduler, nil)},
	})

	invoice := NewGoFunction(stack, "BuildInvoice", FunctionProps{
		Entry:   "services/billing/invoice",
		Timeout: 120,
		Environment: map[string]*string{
			"BILLING_TABLE":  table.TableName(),
			"INVOICE_BUCKET": invoices.BucketName(),
		},
		AlarmTopic: props.AlarmTopic,
	})
	table.GrantReadWriteData(invoice)
	invoices.GrantPut(invoice, jsii.String("invoices/*"))
	invoice.AddEventSource(awslambdaeventsources.NewSqsEventSource(jobs.Queue, &awslambdaeventsources.SqsEventSourceProps{
		BatchSize:               jsii.Number(5),
		ReportBatchItemFailures: jsii.Bool(true),
	}))

	return &BillingStack{Stack: stack}
}
