// Package tracking holds the location ping shared by producer and consumer.
package tracking

import "time"

type Ping struct {
	DriverID   string    `json:"driverId"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	RecordedAt time.Time `json:"recordedAt"`
}

// Position is the latest known location of a driver.
type Position struct {
	PK         string    `dynamodbav:"pk"`
	SK         string    `dynamodbav:"sk"`
	Lat        float64   `dynamodbav:"lat"`
	Lng        float64   `dynamodbav:"lng"`
	RecordedAt time.Time `dynamodbav:"recordedAt"`
	ExpiresAt  int64     `dynamodbav:"expiresAt"`
}

func PositionKey(driverID string) (pk, sk string) {
	return "DRIVER#" + driverID, "POSITION"
}
