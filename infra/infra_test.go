package infra

import (
	"testing"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/assertions"
	"github.com/aws/jsii-runtime-go"
)

func TestOrdersTableIsRetainedWithPITR(t *testing.T) {
	defer jsii.Close()
	app := awscdk.NewApp(nil)
	platform := NewPlatformStack(app, "Platform", nil)
	orders := NewOrdersStack(app, "Orders", &OrdersStackProps{
		UserPool:   platform.UserPool,
		Bus:        platform.Bus,
		AlarmTopic: platform.AlarmTopic,
	})

	template := assertions.Template_FromStack(orders.Stack, nil)
	template.HasResource(jsii.String("AWS::DynamoDB::Table"), map[string]any{
		"DeletionPolicy": "Retain",
		"Properties": map[string]any{
			"PointInTimeRecoverySpecification": map[string]any{"PointInTimeRecoveryEnabled": true},
		},
	})
}

func consoleTemplate(t *testing.T) assertions.Template {
	t.Helper()
	// Skip bundling: these tests check the template, not the Lambda or web builds.
	app := awscdk.NewApp(&awscdk.AppProps{Context: &map[string]any{"aws:cdk:bundling-stacks": []string{}}})
	platform := NewPlatformStack(app, "Platform", nil)
	orders := NewOrdersStack(app, "Orders", &OrdersStackProps{UserPool: platform.UserPool, Bus: platform.Bus, AlarmTopic: platform.AlarmTopic})
	dispatch := NewDispatchStack(app, "Dispatch", &DispatchStackProps{UserPool: platform.UserPool, Bus: platform.Bus, AlarmTopic: platform.AlarmTopic, OrdersTable: orders.Table})
	tracking := NewTrackingStack(app, "Tracking", &TrackingStackProps{UserPool: platform.UserPool, AlarmTopic: platform.AlarmTopic, OrdersTable: orders.Table})
	proof := NewProofStack(app, "Proof", &ProofStackProps{UserPool: platform.UserPool, Bus: platform.Bus, AlarmTopic: platform.AlarmTopic, OrdersTable: orders.Table})
	console := NewConsoleStack(app, "Console", &ConsoleStackProps{
		UserPool: platform.UserPool, AppClient: platform.AppClient, SmokeClient: platform.SmokeClient,
		Bus: platform.Bus, AlarmTopic: platform.AlarmTopic, StateMachine: dispatch.StateMachine,
		Drivers: dispatch.Drivers, PingStream: tracking.Stream, OrdersAPI: orders.API,
		DispatchAPI: dispatch.API, TrackingAPI: tracking.API, ProofAPI: proof.API,
		SenderEmail: "ops@example.com",
	})
	return assertions.Template_FromStack(console.Stack, nil)
}

func TestConsoleSiteBucketIsPrivateBehindOAC(t *testing.T) {
	defer jsii.Close()
	template := consoleTemplate(t)

	template.HasResourceProperties(jsii.String("AWS::S3::Bucket"), map[string]any{
		"PublicAccessBlockConfiguration": map[string]any{
			"BlockPublicAcls": true, "BlockPublicPolicy": true, "IgnorePublicAcls": true, "RestrictPublicBuckets": true,
		},
	})
	template.ResourceCountIs(jsii.String("AWS::CloudFront::OriginAccessControl"), jsii.Number(1))
}

func TestConsoleLiveChannelSubscribesWithCognitoAndPublishesWithIAM(t *testing.T) {
	defer jsii.Close()
	template := consoleTemplate(t)

	template.HasResourceProperties(jsii.String("AWS::AppSync::Api"), map[string]any{
		"EventConfig": map[string]any{
			"DefaultPublishAuthModes":   []any{map[string]any{"AuthType": "AWS_IAM"}},
			"DefaultSubscribeAuthModes": []any{map[string]any{"AuthType": "AMAZON_COGNITO_USER_POOLS"}},
		},
	})
	template.HasResourceProperties(jsii.String("AWS::AppSync::ChannelNamespace"), map[string]any{
		"CodeHandlers": assertions.Match_StringLikeRegexp(jsii.String("includes\\('ops'\\)")),
	})
}

func TestConsoleSmokeRunEndpointNeedsACognitoToken(t *testing.T) {
	defer jsii.Close()
	template := consoleTemplate(t)

	template.HasResourceProperties(jsii.String("AWS::ApiGateway::Method"), map[string]any{
		"HttpMethod":        "POST",
		"AuthorizationType": "COGNITO_USER_POOLS",
	})
}

func TestPlatformAddsOpsGroupAndAnAdminOnlySmokeClient(t *testing.T) {
	defer jsii.Close()
	app := awscdk.NewApp(nil)
	template := assertions.Template_FromStack(NewPlatformStack(app, "Platform", nil).Stack, nil)

	template.HasResourceProperties(jsii.String("AWS::Cognito::UserPoolGroup"), map[string]any{"GroupName": "ops"})
	template.HasResourceProperties(jsii.String("AWS::Cognito::UserPoolClient"), map[string]any{
		"ExplicitAuthFlows": []any{"ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"},
	})
	template.HasResourceProperties(jsii.String("AWS::Cognito::UserPoolClient"), map[string]any{
		"ExplicitAuthFlows": []any{"ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"},
	})
}
