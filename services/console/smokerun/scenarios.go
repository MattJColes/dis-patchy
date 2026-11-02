package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-sdk-go-v2/aws"
	ciptypes "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	sfntypes "github.com/aws/aws-sdk-go-v2/service/sfn/types"
)

var scenarioSteps = []struct {
	name string
	fn   stepFunc
}{
	{"Preparing the village test fleet", prepareScenario},
	{"Placing scenario orders", placeScenario},
	{"Exercising the scenario", exerciseScenario},
	{"Reading actual order and fleet state", observeScenario},
}

func prepareScenario(ctx context.Context, r *run) (string, error) {
	if err := r.parkPreviousFleet(ctx); err != nil {
		return "", err
	}
	password := randomPassword()
	r.driverTokens, r.shopTokens = map[string]string{}, map[string]string{}
	fleet := console.Catalog()
	for _, shop := range fleet.Shops {
		email := "village-" + shop.ID + "@dispatchy.test"
		attr := ciptypes.AttributeType{Name: aws.String("custom:shop_id"), Value: &shop.ID}
		if err := r.ensureUser(ctx, email, "shops", password, attr); err != nil {
			return "", err
		}
		token, err := r.idToken(ctx, email, password)
		if err != nil {
			return "", err
		}
		r.shopTokens[shop.ID] = token
	}
	r.shopToken = r.shopTokens[fleet.Shops[0].ID]
	for i := range 2 {
		email := fmt.Sprintf("village-driver-%d@dispatchy.test", i+1)
		if err := r.ensureUser(ctx, email, "drivers", password); err != nil {
			return "", err
		}
		id, err := r.driverSub(ctx, email)
		if err != nil {
			return "", err
		}
		profile := console.Driver{ID: id, Name: fmt.Sprintf("Courier %d", i+1), VehicleID: fleet.Vehicles[i].ID, DepotID: "riverside", Status: console.DriverAvailable}
		if err := r.seedProfile(ctx, profile); err != nil {
			return "", err
		}
		token, err := r.idToken(ctx, email, password)
		if err != nil {
			return "", err
		}
		r.driverTokens[id] = token
		fleet.Drivers = append(fleet.Drivers, profile)
	}
	return "three test shops and two test scooters prepared; this explicitly resets test fixtures", r.saveFleet(ctx, fleet.Drivers)
}

func placeScenario(ctx context.Context, r *run) (string, error) {
	if r.scenario == console.ScenarioRetry {
		return raceOrders(ctx, r)
	}
	count := 1
	if r.scenario == console.ScenarioRush {
		count = 3
	}
	fleet := console.Catalog()
	for i := range count {
		r.shopToken = r.shopTokens[fleet.Shops[i].ID]
		id, err := r.createOrder(ctx, fmt.Sprintf("%s-%d", r.id, i))
		if err != nil {
			return "", err
		}
		r.orders = append(r.orders, id)
	}
	r.orderID = r.orders[0]
	return fmt.Sprintf("order %s; %d orders for a fleet of two", r.orderID, len(r.orders)), nil
}

func raceOrders(ctx context.Context, r *run) (string, error) {
	type result struct {
		id  string
		err error
	}
	results := make([]result, 2)
	var wg sync.WaitGroup
	for i := range results {
		wg.Go(func() { results[i].id, results[i].err = r.createOrder(ctx, r.id) })
	}
	wg.Wait()
	var failures []error
	for _, result := range results {
		if result.err != nil {
			failures = append(failures, result.err)
		} else if !contains(r.orders, result.id) {
			r.orders = append(r.orders, result.id)
		}
	}
	if len(r.orders) > 0 {
		r.orderID = r.orders[0]
	}
	return fmt.Sprintf("same key returned %d distinct orders: %s", len(r.orders), strings.Join(r.orders, ", ")), errors.Join(failures...)
}

func contains(ids []string, id string) bool {
	for _, existing := range ids {
		if existing == id {
			return true
		}
	}
	return false
}

func exerciseScenario(ctx context.Context, r *run) (string, error) {
	switch r.scenario {
	case console.ScenarioRetry:
		return "concurrent requests completed; inspect the distinct order IDs above", nil
	case console.ScenarioRush:
		return exerciseRush(ctx, r)
	}
	if _, err := waitForOffer(ctx, r); err != nil {
		return "", err
	}
	if r.scenario == console.ScenarioIgnored {
		return "left the offer unanswered for 30 seconds; this does not add an offer timeout", pause(ctx, 30*time.Second)
	}
	if _, err := acceptOffer(ctx, r); err != nil {
		return "", err
	}
	if _, err := collectParcel(ctx, r); err != nil {
		return "", err
	}
	switch r.scenario {
	case console.ScenarioMalformed:
		out, err := callBody(ctx, http.MethodPost, r.trackingAPI+"/pings", r.driverToken, strings.NewReader("{malformed"), nil)
		if err != nil {
			return "", err
		}
		return "malformed JSON API response: " + string(out), pause(ctx, 5*time.Second)
	case console.ScenarioStale:
		return sendStalePings(ctx, r)
	case console.ScenarioInterrupted:
		for i := range 3 {
			if err := r.ping(ctx, map[string]any{"lat": route.fromLat + float64(i)*0.0001, "lng": route.fromLng}); err != nil {
				return "", err
			}
		}
		return "sent three pings, then observed 30 seconds of silence", pause(ctx, 30*time.Second)
	case console.ScenarioDuplicate:
		if _, err := drive(ctx, r); err != nil {
			return "", err
		}
		if _, err := uploadProof(ctx, r); err != nil {
			return "", err
		}
		if _, err := waitForDelivery(ctx, r); err != nil {
			return "", err
		}
		if _, err := uploadProof(ctx, r); err != nil {
			return "", err
		}
		return "uploaded two proofs for the same order; watch for repeated delivery events", pause(ctx, 5*time.Second)
	default:
		return "", errors.New("unsupported scenario")
	}
}

func exerciseRush(ctx context.Context, r *run) (string, error) {
	var observations []string
	fleet := console.Catalog()
	for i, id := range r.orders {
		r.orderID, r.shopToken, r.proofURL = id, r.shopTokens[fleet.Shops[i].ID], ""
		err := waitFor(ctx, 20*time.Second, "a rush-hour offer", func() error { return r.findTaskToken(ctx) })
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			observations = append(observations, id+": "+err.Error())
			continue
		}
		for _, step := range []stepFunc{acceptOffer, collectParcel, drive, uploadProof, waitForDelivery} {
			if _, err := step(ctx, r); err != nil {
				return "", err
			}
		}
		observations = append(observations, id+": delivered")
	}
	return strings.Join(observations, "; "), nil
}

func (r *run) ping(ctx context.Context, body map[string]any) error {
	_, err := call(ctx, http.MethodPost, r.trackingAPI+"/pings", r.driverToken, body, nil)
	return err
}

func sendStalePings(ctx context.Context, r *run) (string, error) {
	now := time.Now().UTC()
	if err := r.ping(ctx, map[string]any{"lat": route.toLat, "lng": route.toLng, "recordedAt": now}); err != nil {
		return "", err
	}
	if err := pause(ctx, 3*time.Second); err != nil {
		return "", err
	}
	older := now.Add(-10 * time.Minute)
	if err := r.ping(ctx, map[string]any{"lat": route.fromLat, "lng": route.fromLng, "recordedAt": older}); err != nil {
		return "", err
	}
	return "sent a new position, then one recorded ten minutes earlier", pause(ctx, 5*time.Second)
}

func observeScenario(ctx context.Context, r *run) (string, error) {
	var observations []string
	for _, id := range r.orders {
		if r.scenario == console.ScenarioRush {
			for i, candidate := range r.orders {
				if candidate == id {
					r.shopToken = r.shopTokens[console.Catalog().Shops[i].ID]
				}
			}
		}
		body, err := call(ctx, http.MethodGet, r.ordersAPI+"/orders/"+id, r.shopToken, nil, nil)
		if err != nil {
			return "", err
		}
		var order struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(body, &order); err != nil || order.Status == "" {
			return "", errors.New("order response has no status")
		}
		observations = append(observations, id+": "+order.Status)
		arn := r.executionARN(id)
		execution, err := r.sfn.DescribeExecution(ctx, &sfn.DescribeExecutionInput{ExecutionArn: &arn})
		if err != nil {
			return "", err
		}
		observations = append(observations, "dispatch "+string(execution.Status))
	}
	if r.scenario == console.ScenarioStale || r.scenario == console.ScenarioMalformed {
		eta, err := readETA(ctx, r)
		if err != nil {
			return "", err
		}
		observations = append(observations, eta)
	}
	fleet, err := console.ReadFleet(ctx, r.db, r.consoleTable, r.driversTable)
	if err != nil {
		return "", err
	}
	for _, driver := range fleet.Drivers {
		observations = append(observations, driver.Name+": "+string(driver.Status))
	}
	return strings.Join(observations, "; "), nil
}

func pause(ctx context.Context, duration time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(duration):
		return nil
	}
}

func (r *run) executionARN(orderID string) string {
	return strings.Replace(r.machine, ":stateMachine:", ":execution:", 1) + ":" + orderID
}

// stopExecutions cleans up only known test executions, never releases drivers.
func (r *run) stopExecutions() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, id := range r.orders {
		arn := r.executionARN(id)
		execution, err := r.sfn.DescribeExecution(ctx, &sfn.DescribeExecutionInput{ExecutionArn: &arn})
		if err == nil && execution.Status == sfntypes.ExecutionStatusRunning {
			_, err = r.sfn.StopExecution(ctx, &sfn.StopExecutionInput{
				ExecutionArn: &arn, Cause: aws.String("test observation finished; fixture cleanup"),
			})
		}
		if err != nil {
			slog.Warn("stop test execution", "orderId", id, "err", err)
		}
	}
}
