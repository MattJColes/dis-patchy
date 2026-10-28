package infra

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsappsync"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscloudfront"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscloudfrontorigins"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscognito"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsdynamodb"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awseventstargets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awskinesis"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambdaeventsources"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3assets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awss3deployment"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	sfn "github.com/aws/aws-cdk-go/awscdk/v2/awsstepfunctions"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type ConsoleStackProps struct {
	awscdk.StackProps
	UserPool     awscognito.IUserPool
	AppClient    awscognito.IUserPoolClient
	SmokeClient  awscognito.IUserPoolClient
	Bus          awsevents.IEventBus
	AlarmTopic   awssns.ITopic
	StateMachine sfn.IStateMachine
	Drivers      awsdynamodb.ITable
	PingStream   awskinesis.IStream
	OrdersAPI    awsapigateway.RestApi
	DispatchAPI  awsapigateway.RestApi
	TrackingAPI  awsapigateway.RestApi
	ProofAPI     awsapigateway.RestApi
	SenderEmail  string
}

// ConsoleStack is the live console: a page that animates what happens
// across the system and can start a smoke run. Only the ops group can
// subscribe or start runs; the static page itself holds no data.
type ConsoleStack struct {
	awscdk.Stack
}

// onSubscribe runs for every subscriber. Publishers are the relay Lambdas,
// which use IAM, so the Cognito group check only needs to guard subscribe.
const liveHandler = `import { util } from '@aws-appsync/utils';
export function onSubscribe(ctx) {
  if (!(ctx.identity?.groups ?? []).includes('ops')) {
    util.unauthorized();
  }
}`

func NewConsoleStack(scope constructs.Construct, id string, props *ConsoleStackProps) *ConsoleStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)
	tag(stack, "console")

	live := newLiveApi(stack, props.UserPool)
	newRelays(stack, props, live)
	smokeAPI := newSmokeRunner(stack, props, live)
	site := newConsoleSite(stack, props, live, smokeAPI)

	awscdk.NewCfnOutput(stack, jsii.String("ConsoleUrl"), &awscdk.CfnOutputProps{
		Value: jsii.String("https://" + *site.DistributionDomainName()),
	})
	return &ConsoleStack{Stack: stack}
}

func newLiveApi(stack awscdk.Stack, pool awscognito.IUserPool) awsappsync.EventApi {
	iam := awsappsync.AppSyncAuthorizationType_IAM
	cognito := awsappsync.AppSyncAuthorizationType_USER_POOL
	api := awsappsync.NewEventApi(stack, jsii.String("Live"), &awsappsync.EventApiProps{
		ApiName: jsii.String("dis-patchy-live"),
		AuthorizationConfig: &awsappsync.EventApiAuthConfig{
			AuthProviders: &[]*awsappsync.AppSyncAuthProvider{
				{AuthorizationType: iam},
				{AuthorizationType: cognito, CognitoConfig: &awsappsync.AppSyncCognitoConfig{UserPool: pool}},
			},
			ConnectionAuthModeTypes:       &[]awsappsync.AppSyncAuthorizationType{iam, cognito},
			DefaultPublishAuthModeTypes:   &[]awsappsync.AppSyncAuthorizationType{iam},
			DefaultSubscribeAuthModeTypes: &[]awsappsync.AppSyncAuthorizationType{cognito},
		},
	})
	api.AddChannelNamespace(jsii.String("live"), &awsappsync.ChannelNamespaceOptions{
		Code: awsappsync.Code_FromInline(jsii.String(liveHandler)),
	})
	return api
}

func liveFunction(stack awscdk.Stack, id, entry string, live awsappsync.EventApi, p FunctionProps) awslambda.Function {
	p.Entry = entry
	if p.Environment == nil {
		p.Environment = map[string]*string{}
	}
	p.Environment["EVENTS_HTTP_DNS"] = live.HttpDns()
	fn := NewGoFunction(stack, id, p)
	live.GrantPublish(fn)
	return fn
}

func newRelays(stack awscdk.Stack, props *ConsoleStackProps, live awsappsync.EventApi) {
	relay := liveFunction(stack, "LiveRelay", "services/console/relay", live, FunctionProps{Timeout: 10, AlarmTopic: props.AlarmTopic})
	awsevents.NewRule(stack, jsii.String("BusToLive"), &awsevents.RuleProps{
		EventBus:     props.Bus,
		EventPattern: &awsevents.EventPattern{Source: awsevents.Match_Prefix(jsii.String("dispatchy."))},
		Targets:      &[]awsevents.IRuleTarget{awseventstargets.NewLambdaFunction(relay, nil)},
	})
	// Step Functions reports status changes on the default bus only.
	awsevents.NewRule(stack, jsii.String("WorkflowToLive"), &awsevents.RuleProps{
		EventPattern: &awsevents.EventPattern{
			Source:     jsii.Strings("aws.states"),
			DetailType: jsii.Strings("Step Functions Execution Status Change"),
			Detail:     &map[string]any{"stateMachineArn": []*string{props.StateMachine.StateMachineArn()}},
		},
		Targets: &[]awsevents.IRuleTarget{awseventstargets.NewLambdaFunction(relay, nil)},
	})

	pings := liveFunction(stack, "PingRelay", "services/console/pingrelay", live, FunctionProps{Timeout: 10, AlarmTopic: props.AlarmTopic})
	pings.AddEventSource(awslambdaeventsources.NewKinesisEventSource(props.PingStream, &awslambdaeventsources.KinesisEventSourceProps{
		StartingPosition:  awslambda.StartingPosition_LATEST,
		BatchSize:         jsii.Number(100),
		MaxBatchingWindow: awscdk.Duration_Seconds(jsii.Number(1)),
	}))
}

// apiURL drops the stage URL's trailing slash so handlers can append paths.
func apiURL(api awsapigateway.RestApi) *string {
	return awscdk.Fn_Join(jsii.String(""), &[]*string{
		jsii.String("https://"), api.RestApiId(), jsii.String(".execute-api."), api.Stack().Region(),
		jsii.String("."), api.Stack().UrlSuffix(), jsii.String("/"), api.DeploymentStage().StageName(),
	})
}

func newSmokeRunner(stack awscdk.Stack, props *ConsoleStackProps, live awsappsync.EventApi) awsapigateway.RestApi {
	table := NewSingleTable(stack, "Console", "expiresAt")

	runner := liveFunction(stack, "SmokeRun", "services/console/smokerun", live, FunctionProps{
		Timeout:    300,
		AlarmTopic: props.AlarmTopic,
		Environment: map[string]*string{
			"USER_POOL_ID":      props.UserPool.UserPoolId(),
			"SMOKE_CLIENT_ID":   props.SmokeClient.UserPoolClientId(),
			"CUSTOMER_EMAIL":    jsii.String(props.SenderEmail), // always SES-verified
			"DRIVERS_TABLE":     props.Drivers.TableName(),
			"CONSOLE_TABLE":     table.TableName(),
			"STATE_MACHINE_ARN": props.StateMachine.StateMachineArn(),
			"ORDERS_API":        apiURL(props.OrdersAPI),
			"DISPATCH_API":      apiURL(props.DispatchAPI),
			"TRACKING_API":      apiURL(props.TrackingAPI),
			"PROOF_API":         apiURL(props.ProofAPI),
		},
	})
	// A retried run would race the next one for the shared smoke driver.
	runner.ConfigureAsyncInvoke(&awslambda.EventInvokeConfigOptions{RetryAttempts: jsii.Number(0)})
	props.UserPool.Grant(runner,
		jsii.String("cognito-idp:AdminCreateUser"), jsii.String("cognito-idp:AdminSetUserPassword"),
		jsii.String("cognito-idp:AdminAddUserToGroup"), jsii.String("cognito-idp:AdminGetUser"),
		jsii.String("cognito-idp:AdminInitiateAuth"))
	props.Drivers.GrantWriteData(runner)
	props.StateMachine.GrantRead(runner)
	table.GrantWriteData(runner)

	start := NewGoFunction(stack, "StartSmokeRun", FunctionProps{
		Entry:       "services/console/startsmoke",
		Timeout:     10,
		AlarmTopic:  props.AlarmTopic,
		Environment: map[string]*string{"CONSOLE_TABLE": table.TableName(), "RUNNER_FUNCTION": runner.FunctionName()},
	})
	table.GrantWriteData(start)
	runner.GrantInvoke(start)

	api := NewServiceAPI(stack, "ConsoleApi", props.UserPool)
	// CloudFront forwards /api/* unchanged, so the resource keeps the prefix.
	api.API.Root().AddResource(jsii.String("api"), nil).
		AddResource(jsii.String("smoke-runs"), nil).
		AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(start, nil), api.Authed)
	return api.API
}

func newConsoleSite(stack awscdk.Stack, props *ConsoleStackProps, live awsappsync.EventApi, smokeAPI awsapigateway.RestApi) awscloudfront.Distribution {
	bucket := awss3.NewBucket(stack, jsii.String("Site"), &awss3.BucketProps{
		BlockPublicAccess: awss3.BlockPublicAccess_BLOCK_ALL(),
		Encryption:        awss3.BucketEncryption_S3_MANAGED,
		EnforceSSL:        jsii.Bool(true),
		// Only build output lives here, so it can go with the stack.
		RemovalPolicy:     awscdk.RemovalPolicy_DESTROY,
		AutoDeleteObjects: jsii.Bool(true),
	})

	csp := awscdk.Fn_Join(jsii.String(""), &[]*string{
		jsii.String("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
			"worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; connect-src 'self' https://cognito-idp."),
		stack.Region(), jsii.String(".amazonaws.com https://"), live.HttpDns(), jsii.String(" wss://"), live.RealtimeDns(),
	})
	headers := awscloudfront.NewResponseHeadersPolicy(stack, jsii.String("SiteHeaders"), &awscloudfront.ResponseHeadersPolicyProps{
		SecurityHeadersBehavior: &awscloudfront.ResponseSecurityHeadersBehavior{
			ContentSecurityPolicy: &awscloudfront.ResponseHeadersContentSecurityPolicy{ContentSecurityPolicy: csp, Override: jsii.Bool(true)},
			ContentTypeOptions:    &awscloudfront.ResponseHeadersContentTypeOptions{Override: jsii.Bool(true)},
			FrameOptions:          &awscloudfront.ResponseHeadersFrameOptions{FrameOption: awscloudfront.HeadersFrameOption_DENY, Override: jsii.Bool(true)},
			ReferrerPolicy:        &awscloudfront.ResponseHeadersReferrerPolicy{ReferrerPolicy: awscloudfront.HeadersReferrerPolicy_NO_REFERRER, Override: jsii.Bool(true)},
			StrictTransportSecurity: &awscloudfront.ResponseHeadersStrictTransportSecurity{
				AccessControlMaxAge: awscdk.Duration_Days(jsii.Number(365)), IncludeSubdomains: jsii.Bool(true), Override: jsii.Bool(true),
			},
		},
	})

	dist := awscloudfront.NewDistribution(stack, jsii.String("SiteDistribution"), &awscloudfront.DistributionProps{
		DefaultRootObject: jsii.String("index.html"),
		DefaultBehavior: &awscloudfront.BehaviorOptions{
			Origin:                awscloudfrontorigins.S3BucketOrigin_WithOriginAccessControl(bucket, nil),
			ViewerProtocolPolicy:  awscloudfront.ViewerProtocolPolicy_REDIRECT_TO_HTTPS,
			ResponseHeadersPolicy: headers,
		},
		AdditionalBehaviors: &map[string]*awscloudfront.BehaviorOptions{
			"/api/*": {
				Origin:                awscloudfrontorigins.NewRestApiOrigin(smokeAPI, nil),
				ViewerProtocolPolicy:  awscloudfront.ViewerProtocolPolicy_HTTPS_ONLY,
				AllowedMethods:        awscloudfront.AllowedMethods_ALLOW_ALL(),
				CachePolicy:           awscloudfront.CachePolicy_CACHING_DISABLED(),
				OriginRequestPolicy:   awscloudfront.OriginRequestPolicy_ALL_VIEWER_EXCEPT_HOST_HEADER(),
				ResponseHeadersPolicy: headers,
			},
		},
	})

	awss3deployment.NewBucketDeployment(stack, jsii.String("SiteDeployment"), &awss3deployment.BucketDeploymentProps{
		DestinationBucket: bucket,
		Distribution:      dist,
		DistributionPaths: jsii.Strings("/*"),
		Sources: &[]awss3deployment.ISource{
			consoleBuild(),
			awss3deployment.Source_JsonData(jsii.String("config.json"), map[string]any{
				"region":         stack.Region(),
				"userPoolId":     props.UserPool.UserPoolId(),
				"clientId":       props.AppClient.UserPoolClientId(),
				"eventsEndpoint": jsii.String("https://" + *live.HttpDns() + "/event"),
			}, nil),
		},
	})
	return dist
}

var consoleDir = filepath.Join(moduleRoot, "web", "console")

const consoleBuildCmd = "npm ci --no-audit --no-fund && npm run build"

// localNpm builds the console with the local Node toolchain when there is
// one, so Docker stays optional, as it is for the Lambdas.
type localNpm struct{}

func (*localNpm) TryBundle(outputDir *string, _ *awscdk.BundlingOptions) *bool {
	if _, err := exec.LookPath("npm"); err != nil {
		return jsii.Bool(false)
	}
	cmd := exec.Command("bash", "-c", consoleBuildCmd+" && cp -R dist/. "+*outputDir)
	cmd.Dir = consoleDir
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		panic(fmt.Errorf("build web/console: %w", err))
	}
	return jsii.Bool(true)
}

func consoleBuild() awss3deployment.ISource {
	return awss3deployment.Source_Asset(jsii.String(consoleDir), &awss3assets.AssetOptions{
		Exclude: jsii.Strings("node_modules", "dist"),
		Bundling: &awscdk.BundlingOptions{
			Image:       awscdk.DockerImage_FromRegistry(jsii.String("node:20")),
			Command:     jsii.Strings("bash", "-c", consoleBuildCmd+" && cp -R dist/. /asset-output/"),
			Environment: &map[string]*string{"npm_config_cache": jsii.String("/tmp/.npm")},
			Local:       &localNpm{},
		},
	})
}
