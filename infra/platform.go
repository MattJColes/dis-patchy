package infra

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

// EventSource values every publisher and rule must agree on.
const (
	SourceOrders   = "dispatchy.orders"
	SourceDispatch = "dispatchy.dispatch"
	SourceProof    = "dispatchy.proof"
)

// PlatformStack owns what every context shares: identity, the event bus and
// the ops alarm topic.
type PlatformStack struct {
	awscdk.Stack
	UserPool   awscognito.UserPool
	Bus        awsevents.EventBus
	AlarmTopic awssns.Topic
}

func NewPlatformStack(scope constructs.Construct, id string, props *awscdk.StackProps) *PlatformStack {
	stack := awscdk.NewStack(scope, jsii.String(id), props)
	tag(stack, "platform")

	pool := awscognito.NewUserPool(stack, jsii.String("Users"), &awscognito.UserPoolProps{
		SelfSignUpEnabled: jsii.Bool(false),
		SignInAliases:     &awscognito.SignInAliases{Email: jsii.Bool(true)},
		CustomAttributes: &map[string]awscognito.ICustomAttribute{
			"shop_id": awscognito.NewStringAttribute(&awscognito.StringAttributeProps{Mutable: jsii.Bool(false)}),
		},
		AccountRecovery: awscognito.AccountRecovery_EMAIL_ONLY,
		Mfa:             awscognito.Mfa_OPTIONAL,
		MfaSecondFactor: &awscognito.MfaSecondFactor{Otp: jsii.Bool(true), Sms: jsii.Bool(false)},
		RemovalPolicy:   awscdk.RemovalPolicy_RETAIN,
	})
	pool.AddClient(jsii.String("AppClient"), &awscognito.UserPoolClientOptions{
		AuthFlows: &awscognito.AuthFlow{UserSrp: jsii.Bool(true)},
	})
	for _, group := range []string{"shops", "drivers"} {
		awscognito.NewCfnUserPoolGroup(stack, jsii.String(group+"Group"), &awscognito.CfnUserPoolGroupProps{
			UserPoolId: pool.UserPoolId(),
			GroupName:  jsii.String(group),
		})
	}

	bus := awsevents.NewEventBus(stack, jsii.String("Bus"), &awsevents.EventBusProps{
		EventBusName: jsii.String("dis-patchy"),
	})
	bus.Archive(jsii.String("Archive"), &awsevents.BaseArchiveProps{
		EventPattern: &awsevents.EventPattern{Account: jsii.Strings(*stack.Account())},
		Retention:    awscdk.Duration_Days(jsii.Number(30)),
	})

	topic := awssns.NewTopic(stack, jsii.String("Alarms"), &awssns.TopicProps{
		EnforceSSL: jsii.Bool(true),
	})

	return &PlatformStack{Stack: stack, UserPool: pool, Bus: bus, AlarmTopic: topic}
}
