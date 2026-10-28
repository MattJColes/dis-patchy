package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3notifications"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type ProofStackProps struct {
	awscdk.StackProps
	UserPool    awscognito.IUserPool
	Bus         awsevents.IEventBus
	AlarmTopic  awssns.ITopic
	OrdersTable awsdynamodb.ITable
}

// ProofStack stores proof-of-delivery photos. A new photo is what closes an
// order and announces OrderDelivered.
type ProofStack struct {
	awscdk.Stack
	API awsapigateway.RestApi
}

func NewProofStack(scope constructs.Construct, id string, props *ProofStackProps) *ProofStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "proof")

	photos := awss3.NewBucket(stack, jsii.String("ProofPhotos"), &awss3.BucketProps{
		BlockPublicAccess: awss3.BlockPublicAccess_BLOCK_ALL(),
		Encryption:        awss3.BucketEncryption_S3_MANAGED,
		EnforceSSL:        jsii.Bool(true),
		Versioned:         jsii.Bool(true),
		RemovalPolicy:     awscdk.RemovalPolicy_RETAIN,
		LifecycleRules: &[]*awss3.LifecycleRule{{
			Transitions: &[]*awss3.Transition{{
				StorageClass:    awss3.StorageClass_INFREQUENT_ACCESS(),
				TransitionAfter: awscdk.Duration_Days(jsii.Number(90)),
			}},
		}},
	})

	uploadURL := NewGoFunction(stack, "ProofUploadUrl", FunctionProps{
		Entry:   "services/proof/uploadurl",
		Timeout: 5,
		Environment: map[string]*string{
			"BUCKET_NAME":  photos.BucketName(),
			"ORDERS_TABLE": props.OrdersTable.TableName(),
		},
		AlarmTopic: props.AlarmTopic,
	})
	photos.GrantPut(uploadURL, jsii.String("proof/*"))
	props.OrdersTable.GrantReadData(uploadURL)

	delivered := NewGoFunction(stack, "OrderDelivered", FunctionProps{
		Entry:   "services/proof/delivered",
		Timeout: 15,
		Environment: map[string]*string{
			"ORDERS_TABLE": props.OrdersTable.TableName(),
			"BUS_NAME":     jsii.String("dis-patchy"),
		},
		AlarmTopic: props.AlarmTopic,
	})
	props.OrdersTable.GrantReadWriteData(delivered)
	props.Bus.GrantPutEventsTo(delivered, nil)
	photos.AddEventNotification(awss3.EventType_OBJECT_CREATED,
		awss3notifications.NewLambdaDestination(delivered),
		&awss3.NotificationKeyFilter{Prefix: jsii.String("proof/")})

	api := NewServiceAPI(stack, "ProofApi", props.UserPool)
	api.API.Root().AddResource(jsii.String("orders"), nil).
		AddResource(jsii.String("{orderId}"), nil).
		AddResource(jsii.String("proof"), nil).
		AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(uploadURL, nil), api.Authed)

	return &ProofStack{Stack: stack, API: api.API}
}
