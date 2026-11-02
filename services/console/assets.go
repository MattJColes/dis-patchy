package console

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

//go:embed catalog.json
var catalogJSON []byte

type Shop struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	PickupLat float64 `json:"pickupLat"`
	PickupLng float64 `json:"pickupLng"`
}

type Depot struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Vehicle struct {
	ID      string `json:"id"`
	DepotID string `json:"depotId"`
}

type DriverStatus string

const (
	DriverAvailable DriverStatus = "AVAILABLE"
	DriverOffered   DriverStatus = "OFFERED"
	DriverBusy      DriverStatus = "BUSY"
	DriverOffline   DriverStatus = "OFFLINE"
)

type Driver struct {
	ID        string       `json:"id" dynamodbav:"id"`
	Name      string       `json:"name" dynamodbav:"name"`
	VehicleID string       `json:"vehicleId" dynamodbav:"vehicleId"`
	DepotID   string       `json:"depotId" dynamodbav:"depotId"`
	Status    DriverStatus `json:"status" dynamodbav:"status"`
}

type Fleet struct {
	Shops    []Shop    `json:"shops"`
	Depots   []Depot   `json:"depots"`
	Vehicles []Vehicle `json:"vehicles"`
	Drivers  []Driver  `json:"drivers" dynamodbav:"drivers"`
}

func Catalog() Fleet {
	var fleet Fleet
	if err := json.Unmarshal(catalogJSON, &fleet); err != nil {
		panic(err) // The embedded catalog is validated by tests.
	}
	fleet.Drivers = []Driver{}
	return fleet
}

func FleetKey() map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: "FLEET"}, "sk": &types.AttributeValueMemberS{Value: "META"},
	}
}

// ReadFleet returns the last prepared test fleet with each driver's actual status.
func ReadFleet(ctx context.Context, db *dynamodb.Client, table, driversTable string) (Fleet, error) {
	fleet := Catalog()
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: &table, Key: FleetKey(), ConsistentRead: aws.Bool(true)})
	if err != nil {
		return fleet, err
	}
	var saved struct {
		Drivers []Driver `dynamodbav:"drivers"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &saved); err != nil {
		return fleet, err
	}
	if len(saved.Drivers) > len(fleet.Vehicles) {
		return fleet, fmt.Errorf("test fleet exceeds catalog capacity")
	}
	for _, driver := range saved.Drivers {
		profile, err := db.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: &driversTable, ConsistentRead: aws.Bool(true),
			Key: map[string]types.AttributeValue{
				"pk": &types.AttributeValueMemberS{Value: "DRIVER#" + driver.ID},
				"sk": &types.AttributeValueMemberS{Value: "PROFILE"},
			},
		})
		if err != nil {
			return fleet, err
		}
		if len(profile.Item) == 0 {
			return fleet, fmt.Errorf("test driver %s is missing", driver.ID)
		}
		if err := attributevalue.UnmarshalMap(profile.Item, &driver); err != nil {
			return fleet, err
		}
		switch driver.Status {
		case DriverAvailable, DriverOffered, DriverBusy, DriverOffline:
		default:
			return fleet, fmt.Errorf("test driver %s has unknown status %q", driver.ID, driver.Status)
		}
		fleet.Drivers = append(fleet.Drivers, driver)
	}
	return fleet, nil
}
