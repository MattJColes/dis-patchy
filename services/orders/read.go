package orders

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Read returns the order, or nil when the item is absent.
func Read(ctx context.Context, db *dynamodb.Client, table, orderID string) (*Order, error) {
	pk, sk := Key(orderID)
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: sk},
		},
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var order Order
	return &order, attributevalue.UnmarshalMap(out.Item, &order)
}
