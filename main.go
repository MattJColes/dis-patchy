package main

import (
	"os"

	"github.com/MattJColes/dis-patchy/infra"
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/jsii-runtime-go"
)

func main() {
	defer jsii.Close()

	app := awscdk.NewApp(nil)
	props := &awscdk.StackProps{}
	if account, region := os.Getenv("CDK_DEFAULT_ACCOUNT"), os.Getenv("CDK_DEFAULT_REGION"); account != "" && region != "" {
		props.Env = &awscdk.Environment{Account: jsii.String(account), Region: jsii.String(region)}
	}

	platform := infra.NewPlatformStack(app, "DisPatchy-Platform", props)
	orders := infra.NewOrdersStack(app, "DisPatchy-Orders", &infra.OrdersStackProps{
		StackProps: *props,
		UserPool:   platform.UserPool,
		Bus:        platform.Bus,
		AlarmTopic: platform.AlarmTopic,
	})
	infra.NewDispatchStack(app, "DisPatchy-Dispatch", &infra.DispatchStackProps{
		StackProps:  *props,
		UserPool:    platform.UserPool,
		Bus:         platform.Bus,
		AlarmTopic:  platform.AlarmTopic,
		OrdersTable: orders.Table,
	})

	app.Synth(nil)
}
