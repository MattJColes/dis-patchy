// Package orders is the order record shared by the orders handlers.
package orders

import "time"

type Status string

const (
	StatusPlaced       Status = "PLACED"
	StatusAssigned     Status = "ASSIGNED"
	StatusUnassignable Status = "UNASSIGNABLE"
	StatusDelivered    Status = "DELIVERED"
)

type Order struct {
	PK             string     `dynamodbav:"pk" json:"-"`
	SK             string     `dynamodbav:"sk" json:"-"`
	OrderID        string     `dynamodbav:"orderId" json:"orderId"`
	ShopID         string     `dynamodbav:"shopId" json:"shopId"`
	Status         Status     `dynamodbav:"status" json:"status"`
	DriverID       string     `dynamodbav:"driverId,omitempty" json:"driverId,omitempty"`
	CustomerName   string     `dynamodbav:"customerName" json:"customerName"`
	CustomerEmail  string     `dynamodbav:"customerEmail" json:"customerEmail"`
	DropoffAddress string     `dynamodbav:"dropoffAddress" json:"dropoffAddress"`
	DropoffLat     float64    `dynamodbav:"dropoffLat" json:"dropoffLat"`
	DropoffLng     float64    `dynamodbav:"dropoffLng" json:"dropoffLng"`
	CreatedAt      time.Time  `dynamodbav:"createdAt" json:"createdAt"`
	DeliveredAt    *time.Time `dynamodbav:"deliveredAt,omitempty" json:"deliveredAt,omitempty"`
}

func Key(orderID string) (pk, sk string) {
	return "ORDER#" + orderID, "META"
}
