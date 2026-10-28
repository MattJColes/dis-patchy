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

	infra.NewPlatformStack(app, "DisPatchy-Platform", props)

	app.Synth(nil)
}
