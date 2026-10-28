package main

import (
	"os"

	"github.com/MattJColes/dis-patchy/infra"
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/jsii-runtime-go"
)

// senderEmail is the SES-verified From address: -c senderEmail=you@example.com
func senderEmail(app awscdk.App) string {
	if v, ok := app.Node().TryGetContext(jsii.String("senderEmail")).(string); ok && v != "" {
		return v
	}
	return "notifications@example.com"
}

func main() {
	defer jsii.Close()

	app := awscdk.NewApp(nil)
	props := &awscdk.StackProps{}
	if account, region := os.Getenv("CDK_DEFAULT_ACCOUNT"), os.Getenv("CDK_DEFAULT_REGION"); account != "" && region != "" {
		props.Env = &awscdk.Environment{Account: jsii.String(account), Region: jsii.String(region)}
	}

	sender := senderEmail(app)
	platform := infra.NewPlatformStack(app, "DisPatchy-Platform", props)
	orders := infra.NewOrdersStack(app, "DisPatchy-Orders", &infra.OrdersStackProps{
		StackProps:  *props,
		UserPool:    platform.UserPool,
		Bus:         platform.Bus,
		AlarmTopic:  platform.AlarmTopic,
		SenderEmail: sender,
	})
	dispatch := infra.NewDispatchStack(app, "DisPatchy-Dispatch", &infra.DispatchStackProps{
		StackProps:  *props,
		UserPool:    platform.UserPool,
		Bus:         platform.Bus,
		AlarmTopic:  platform.AlarmTopic,
		OrdersTable: orders.Table,
	})
	tracking := infra.NewTrackingStack(app, "DisPatchy-Tracking", &infra.TrackingStackProps{
		StackProps:  *props,
		UserPool:    platform.UserPool,
		AlarmTopic:  platform.AlarmTopic,
		OrdersTable: orders.Table,
	})
	proof := infra.NewProofStack(app, "DisPatchy-Proof", &infra.ProofStackProps{
		StackProps:  *props,
		UserPool:    platform.UserPool,
		Bus:         platform.Bus,
		AlarmTopic:  platform.AlarmTopic,
		OrdersTable: orders.Table,
	})

	infra.NewNotificationsStack(app, "DisPatchy-Notifications", &infra.NotificationsStackProps{
		StackProps:  *props,
		Bus:         platform.Bus,
		AlarmTopic:  platform.AlarmTopic,
		OrdersTable: orders.Table,
		SenderEmail: sender,
	})
	infra.NewBillingStack(app, "DisPatchy-Billing", &infra.BillingStackProps{
		StackProps: *props,
		Bus:        platform.Bus,
		AlarmTopic: platform.AlarmTopic,
	})

	infra.NewConsoleStack(app, "DisPatchy-Console", &infra.ConsoleStackProps{
		StackProps:   *props,
		UserPool:     platform.UserPool,
		AppClient:    platform.AppClient,
		SmokeClient:  platform.SmokeClient,
		Bus:          platform.Bus,
		AlarmTopic:   platform.AlarmTopic,
		StateMachine: dispatch.StateMachine,
		Drivers:      dispatch.Drivers,
		PingStream:   tracking.Stream,
		OrdersAPI:    orders.API,
		DispatchAPI:  dispatch.API,
		TrackingAPI:  tracking.API,
		ProofAPI:     proof.API,
		SenderEmail:  sender,
	})

	app.Synth(nil)
}
