package console

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func TestCatalogHasValidShopLocationsAndVehicleDepots(t *testing.T) {
	fleet := Catalog()
	if len(fleet.Shops) != 3 || len(fleet.Depots) != 1 || len(fleet.Vehicles) != 3 || len(fleet.Drivers) != 0 {
		t.Fatalf("catalog = %+v", fleet)
	}
	depots, vehicles, shops := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, depot := range fleet.Depots {
		if depot.ID == "" || depot.Name == "" || depots[depot.ID] {
			t.Errorf("invalid depot %+v", depot)
		}
		depots[depot.ID] = true
	}
	for _, vehicle := range fleet.Vehicles {
		if vehicle.ID == "" || vehicles[vehicle.ID] || !depots[vehicle.DepotID] {
			t.Errorf("invalid vehicle %+v", vehicle)
		}
		vehicles[vehicle.ID] = true
	}
	for _, shop := range fleet.Shops {
		if shop.ID == "" || shop.Name == "" || shops[shop.ID] ||
			shop.PickupLat < -90 || shop.PickupLat > 90 || shop.PickupLng < -180 || shop.PickupLng > 180 {
			t.Errorf("invalid shop %+v", shop)
		}
		shops[shop.ID] = true
	}
}

func fleetDB(t *testing.T, saved, profile string) *dynamodb.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".GetItem") {
			t.Errorf("unexpected target %q", r.Header.Get("X-Amz-Target"))
		}
		var in struct{ TableName string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Error(err)
		}
		switch in.TableName {
		case "console":
			_, _ = w.Write([]byte(saved))
		case "drivers":
			_, _ = w.Write([]byte(profile))
		default:
			t.Errorf("unexpected table %q", in.TableName)
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	return dynamodb.NewFromConfig(aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1, BaseEndpoint: aws.String(server.URL),
	})
}

const savedFleet = `{"Item":{"drivers":{"L":[{"M":{"id":{"S":"d1"},"name":{"S":"Courier 1"},"vehicleId":{"S":"scooter-1"},"depotId":{"S":"riverside"},"status":{"S":"AVAILABLE"}}}]}}}`

func TestReadFleetReturnsAnEmptyFleetBeforePreparation(t *testing.T) {
	fleet, err := ReadFleet(t.Context(), fleetDB(t, `{}`, `{}`), "console", "drivers")
	if err != nil {
		t.Fatal(err)
	}
	if len(fleet.Drivers) != 0 || len(fleet.Shops) != 3 || len(fleet.Vehicles) != 3 {
		t.Errorf("fleet = %+v", fleet)
	}
}

func TestReadFleetUsesTheDriversCurrentStatus(t *testing.T) {
	db := fleetDB(t, savedFleet, `{"Item":{"status":{"S":"BUSY"}}}`)
	fleet, err := ReadFleet(t.Context(), db, "console", "drivers")
	if err != nil {
		t.Fatal(err)
	}
	if len(fleet.Drivers) != 1 || fleet.Drivers[0].ID != "d1" || fleet.Drivers[0].Status != DriverBusy ||
		fleet.Drivers[0].VehicleID != "scooter-1" || fleet.Drivers[0].DepotID != "riverside" {
		t.Errorf("fleet drivers = %+v", fleet.Drivers)
	}
}

func TestReadFleetRejectsMissingOrInvalidProfiles(t *testing.T) {
	for _, profile := range []string{`{}`, `{"Item":{"status":{"S":"UNKNOWN"}}}`, `{"Item":{"status":{"N":"1"}}}`} {
		t.Run(profile, func(t *testing.T) {
			if _, err := ReadFleet(t.Context(), fleetDB(t, savedFleet, profile), "console", "drivers"); err == nil {
				t.Fatal("want missing or invalid profile to fail")
			}
		})
	}
}

func TestReadFleetRejectsMoreDriversThanCatalogVehicles(t *testing.T) {
	saved := `{"Item":{"drivers":{"L":[{"M":{"id":{"S":"d1"}}},{"M":{"id":{"S":"d2"}}},{"M":{"id":{"S":"d3"}}},{"M":{"id":{"S":"d4"}}}]}}}`
	if _, err := ReadFleet(t.Context(), fleetDB(t, saved, `{}`), "console", "drivers"); err == nil {
		t.Fatal("want fleet exceeding capacity to fail")
	}
}
