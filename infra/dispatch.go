package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awseventstargets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambdaeventsources"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslogs"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	sfn "github.com/aws/aws-cdk-go/awscdk/v2/awsstepfunctions"
	tasks "github.com/aws/aws-cdk-go/awscdk/v2/awsstepfunctionstasks"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type DispatchStackProps struct {
	awscdk.StackProps
	UserPool    awscognito.IUserPool
	Bus         awsevents.IEventBus
	AlarmTopic  awssns.ITopic
	OrdersTable awsdynamodb.ITable
}

// DispatchStack matches each placed order to a driver. A Step Functions
// workflow claims a driver, offers the job, and waits for acceptance.
type DispatchStack struct {
	awscdk.Stack
}

func NewDispatchStack(scope constructs.Construct, id string, props *DispatchStackProps) *DispatchStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "dispatch")

	drivers := NewSingleTable(stack, "Drivers", "")
	drivers.AddGlobalSecondaryIndex(&awsdynamodb.GlobalSecondaryIndexProps{
		IndexName:      jsii.String("byStatus"),
		PartitionKey:   &awsdynamodb.Attribute{Name: jsii.String("gsi1pk"), Type: awsdynamodb.AttributeType_STRING},
		SortKey:        &awsdynamodb.Attribute{Name: jsii.String("gsi1sk"), Type: awsdynamodb.AttributeType_STRING},
		ProjectionType: awsdynamodb.ProjectionType_KEYS_ONLY,
	})

	offers := awssns.NewTopic(stack, jsii.String("DriverOffers"), &awssns.TopicProps{EnforceSSL: jsii.Bool(true)})

	assignFn := NewGoFunction(stack, "AssignDriver", FunctionProps{
		Entry:       "services/dispatch/assigndriver",
		Timeout:     10,
		Environment: map[string]*string{"DRIVERS_TABLE": drivers.TableName()},
		AlarmTopic:  props.AlarmTopic,
	})
	drivers.GrantReadWriteData(assignFn)

	offerFn := NewGoFunction(stack, "OfferDriver", FunctionProps{
		Entry:       "services/dispatch/offerdriver",
		Timeout:     10,
		Environment: map[string]*string{"OFFERS_TOPIC_ARN": offers.TopicArn()},
		AlarmTopic:  props.AlarmTopic,
	})
	offers.GrantPublish(offerFn)

	machine := newDispatchStateMachine(stack, props, assignFn, offerFn)

	intake := NewQueueWithDLQ(stack, "Intake", QueueProps{
		VisibilityTimeout: awscdk.Duration_Seconds(jsii.Number(30)),
		AlarmTopic:        props.AlarmTopic,
	})
	awsevents.NewRule(stack, jsii.String("OrderPlacedRule"), &awsevents.RuleProps{
		EventBus: props.Bus,
		EventPattern: &awsevents.EventPattern{
			Source:     jsii.Strings(SourceOrders),
			DetailType: jsii.Strings("OrderPlaced"),
		},
		Targets: &[]awsevents.IRuleTarget{awseventstargets.NewSqsQueue(intake.Queue, nil)},
	})

	starter := NewGoFunction(stack, "StartDispatch", FunctionProps{
		Entry:       "services/dispatch/starter",
		Timeout:     60,
		Environment: map[string]*string{"STATE_MACHINE_ARN": machine.StateMachineArn()},
		AlarmTopic:  props.AlarmTopic,
	})
	machine.GrantStartExecution(starter)
	starter.AddEventSource(awslambdaeventsources.NewSqsEventSource(intake.Queue, &awslambdaeventsources.SqsEventSourceProps{
		BatchSize:               jsii.Number(10),
		ReportBatchItemFailures: jsii.Bool(true),
	}))

	acceptFn := NewGoFunction(stack, "AcceptOffer", FunctionProps{
		Entry:       "services/dispatch/acceptoffer",
		Timeout:     10,
		Environment: map[string]*string{"DRIVERS_TABLE": drivers.TableName()},
		AlarmTopic:  props.AlarmTopic,
	})
	machine.GrantTaskResponse(acceptFn)
	drivers.GrantWriteData(acceptFn)

	api := NewServiceAPI(stack, "DispatchApi", props.UserPool)
	api.API.Root().AddResource(jsii.String("offers"), nil).
		AddResource(jsii.String("accept"), nil).
		AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(acceptFn, nil), api.Authed)

	return &DispatchStack{Stack: stack}
}

func orderKey() *map[string]tasks.DynamoAttributeValue {
	return &map[string]tasks.DynamoAttributeValue{
		"pk": tasks.DynamoAttributeValue_FromString(sfn.JsonPath_Format(jsii.String("ORDER#{}"), sfn.JsonPath_StringAt(jsii.String("$.orderId")))),
		"sk": tasks.DynamoAttributeValue_FromString(jsii.String("META")),
	}
}

func setOrderStatus(stack awscdk.Stack, id string, table awsdynamodb.ITable, status string) tasks.DynamoUpdateItem {
	values := map[string]tasks.DynamoAttributeValue{":s": tasks.DynamoAttributeValue_FromString(jsii.String(status))}
	update := "SET #s = :s"
	if status == "ASSIGNED" {
		values[":d"] = tasks.DynamoAttributeValue_FromString(sfn.JsonPath_StringAt(jsii.String("$.acceptance.driverId")))
		update += ", driverId = :d"
	}
	return tasks.NewDynamoUpdateItem(stack, jsii.String(id), &tasks.DynamoUpdateItemProps{
		Table:                     table,
		Key:                       orderKey(),
		UpdateExpression:          jsii.String(update),
		ExpressionAttributeNames:  &map[string]*string{"#s": jsii.String("status")},
		ExpressionAttributeValues: &values,
		ResultPath:                sfn.JsonPath_DISCARD(),
	})
}

// newDispatchStateMachine: assign -> offer (wait for accept) -> mark
// assigned -> publish. An unaccepted offer is retried with a new driver up
// to three times before the order is marked unassignable.
func newDispatchStateMachine(stack awscdk.Stack, props *DispatchStackProps, assignFn, offerFn awslambda.IFunction) sfn.StateMachine {
	init := sfn.NewPass(stack, jsii.String("Init"), &sfn.PassProps{
		Parameters: &map[string]interface{}{
			"orderId":  sfn.JsonPath_StringAt(jsii.String("$.orderId")),
			"shopId":   sfn.JsonPath_StringAt(jsii.String("$.shopId")),
			"attempts": 0,
		},
	})

	assign := tasks.NewLambdaInvoke(stack, jsii.String("ClaimDriver"), &tasks.LambdaInvokeProps{
		LambdaFunction:      assignFn,
		PayloadResponseOnly: jsii.Bool(true),
		ResultPath:          jsii.String("$.driver"),
	})
	assign.AddRetry(&sfn.RetryProps{
		Errors:      jsii.Strings("NoDriverAvailable"),
		Interval:    awscdk.Duration_Seconds(jsii.Number(30)),
		MaxAttempts: jsii.Number(10),
		BackoffRate: jsii.Number(1.5),
	})

	offer := tasks.NewLambdaInvoke(stack, jsii.String("OfferToDriver"), &tasks.LambdaInvokeProps{
		LambdaFunction:     offerFn,
		IntegrationPattern: sfn.IntegrationPattern_WAIT_FOR_TASK_TOKEN,
		Payload: sfn.TaskInput_FromObject(&map[string]interface{}{
			"taskToken": sfn.JsonPath_TaskToken(),
			"orderId":   sfn.JsonPath_StringAt(jsii.String("$.orderId")),
			"driverId":  sfn.JsonPath_StringAt(jsii.String("$.driver.driverId")),
		}),
		ResultPath: jsii.String("$.acceptance"),
	})

	unassignable := setOrderStatus(stack, "MarkUnassignable", props.OrdersTable, "UNASSIGNABLE").
		Next(sfn.NewFail(stack, jsii.String("NoDriverAccepted"), &sfn.FailProps{Error: jsii.String("NoDriverAccepted")}))
	assign.AddCatch(unassignable, &sfn.CatchProps{
		Errors:     jsii.Strings("NoDriverAvailable"),
		ResultPath: jsii.String("$.error"),
	})

	nextAttempt := sfn.NewPass(stack, jsii.String("NextAttempt"), &sfn.PassProps{
		Parameters: &map[string]interface{}{
			"orderId":  sfn.JsonPath_StringAt(jsii.String("$.orderId")),
			"shopId":   sfn.JsonPath_StringAt(jsii.String("$.shopId")),
			"attempts": sfn.JsonPath_MathAdd(sfn.JsonPath_NumberAt(jsii.String("$.attempts")), jsii.Number(1)),
		},
	})
	retry := sfn.NewChoice(stack, jsii.String("RetryWithAnotherDriver?"), nil).
		When(sfn.Condition_NumberLessThan(jsii.String("$.attempts"), jsii.Number(3)), assign, nil).
		Otherwise(unassignable)
	offer.AddCatch(nextAttempt, &sfn.CatchProps{
		Errors:     jsii.Strings(*sfn.Errors_TIMEOUT()),
		ResultPath: jsii.String("$.error"),
	})
	nextAttempt.Next(retry)

	publish := tasks.NewEventBridgePutEvents(stack, jsii.String("PublishDriverAssigned"), &tasks.EventBridgePutEventsProps{
		Entries: &[]*tasks.EventBridgePutEventsEntry{{
			EventBus:   props.Bus,
			Source:     jsii.String(SourceDispatch),
			DetailType: jsii.String("DriverAssigned"),
			Detail: sfn.TaskInput_FromObject(&map[string]interface{}{
				"orderId":  sfn.JsonPath_StringAt(jsii.String("$.orderId")),
				"driverId": sfn.JsonPath_StringAt(jsii.String("$.acceptance.driverId")),
			}),
		}},
		ResultPath: sfn.JsonPath_DISCARD(),
	})

	definition := sfn.Chain_Start(init).
		Next(assign).
		Next(offer).
		Next(setOrderStatus(stack, "MarkAssigned", props.OrdersTable, "ASSIGNED")).
		Next(publish)

	logs := awslogs.NewLogGroup(stack, jsii.String("DispatchWorkflowLogs"), &awslogs.LogGroupProps{
		Retention: awslogs.RetentionDays_ONE_MONTH,
	})
	return sfn.NewStateMachine(stack, jsii.String("DispatchWorkflow"), &sfn.StateMachineProps{
		DefinitionBody: sfn.DefinitionBody_FromChainable(definition),
		TracingEnabled: jsii.Bool(true),
		Logs:           &sfn.LogOptions{Destination: logs, Level: sfn.LogLevel_ERROR},
	})
}
