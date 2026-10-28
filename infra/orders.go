package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsssm"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

// GeocoderKeyParam is the SecureString holding the geocoding API key.
const GeocoderKeyParam = "/dis-patchy/geocoder-api-key"

type OrdersStackProps struct {
	awscdk.StackProps
	UserPool   awscognito.IUserPool
	Bus        awsevents.IEventBus
	AlarmTopic awssns.ITopic
}

// OrdersStack takes orders from shops and announces them on the bus. The
// table is exported so downstream contexts can update order status.
type OrdersStack struct {
	awscdk.Stack
	Table awsdynamodb.Table
}

func NewOrdersStack(scope constructs.Construct, id string, props *OrdersStackProps) *OrdersStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "orders")

	table := NewSingleTable(stack, "Orders", "")

	// SecureString parameters can't be created by CloudFormation; create it
	// once per account (see README) and the stack only references it.
	geocoderKey := awsssm.StringParameter_FromSecureStringParameterAttributes(stack, jsii.String("GeocoderKey"), &awsssm.SecureStringParameterAttributes{
		ParameterName: jsii.String(GeocoderKeyParam),
	})

	create := NewGoFunction(stack, "CreateOrder", FunctionProps{
		Entry:   "services/orders/createorder",
		Timeout: 10,
		Environment: map[string]*string{
			"TABLE_NAME":         table.TableName(),
			"BUS_NAME":           props.Bus.EventBusName(),
			"GEOCODER_URL":       jsii.String("https://geocode.mapsapi.example.com/v1/search"),
			"GEOCODER_KEY_PARAM": geocoderKey.ParameterName(),
		},
		AlarmTopic: props.AlarmTopic,
	})
	table.GrantWriteData(create)
	geocoderKey.GrantRead(create)
	props.Bus.GrantPutEventsTo(create, nil)

	get := NewGoFunction(stack, "GetOrder", FunctionProps{
		Entry:       "services/orders/getorder",
		Timeout:     5,
		Environment: map[string]*string{"TABLE_NAME": table.TableName()},
		AlarmTopic:  props.AlarmTopic,
	})
	table.GrantReadData(get)

	api := NewServiceAPI(stack, "OrdersApi", props.UserPool)
	ordersRes := api.API.Root().AddResource(jsii.String("orders"), nil)
	ordersRes.AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(create, nil), api.Authed)
	ordersRes.AddResource(jsii.String("{orderId}"), nil).
		AddMethod(jsii.String("GET"), awsapigateway.NewLambdaIntegration(get, nil), api.Authed)

	return &OrdersStack{Stack: stack, Table: table}
}
