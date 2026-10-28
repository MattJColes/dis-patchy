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
