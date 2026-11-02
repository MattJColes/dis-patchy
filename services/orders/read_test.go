package orders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func readClient(t *testing.T, serve http.HandlerFunc) *dynamodb.Client {
	t.Helper()
	server := httptest.NewServer(serve)
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	return dynamodb.NewFromConfig(aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1,
	}, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(server.URL) })
}

func TestReadUsesTheOrderKeyAndDefaultConsistency(t *testing.T) {
	client := readClient(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			TableName      string
			Key            map[string]struct{ S string }
			ConsistentRead *bool
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.TableName != "orders-table" || request.Key["pk"].S != "ORDER#o1" ||
			request.Key["sk"].S != "META" || len(request.Key) != 2 || request.ConsistentRead != nil {
			t.Errorf("request = %+v", request)
		}
		_, _ = w.Write([]byte(`{"Item":{"orderId":{"S":"o1"},"shopId":{"S":"s1"},"status":{"S":"ASSIGNED"},"driverId":{"S":"d1"}}}`))
	})
	order, err := Read(t.Context(), client, "orders-table", "o1")
	if err != nil {
		t.Fatal(err)
	}
	if order == nil || order.OrderID != "o1" || order.ShopID != "s1" || order.Status != StatusAssigned || order.DriverID != "d1" {
		t.Errorf("order = %+v", order)
	}
}

func TestReadDistinguishesMissingAndEmptyItems(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		missing        bool
	}{
		{name: "missing", response: `{}`, missing: true},
		{name: "empty", response: `{"Item":{}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := readClient(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(tc.response)) })
			order, err := Read(t.Context(), client, "orders", "o1")
			if err != nil || (order == nil) != tc.missing {
				t.Errorf("order = %+v, error = %v", order, err)
			}
		})
	}
}

func TestReadReturnsTheProviderError(t *testing.T) {
	client := readClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"__type":"ResourceNotFoundException","message":"table missing"}`))
	})
	order, err := Read(t.Context(), client, "orders", "o1")
	var missing *types.ResourceNotFoundException
	if order != nil || !errors.As(err, &missing) {
		t.Errorf("order = %+v, error = %v", order, err)
	}
}

func TestReadReturnsAnAllocatedOrderWithTheDecodeError(t *testing.T) {
	client := readClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"Item":{"dropoffLat":{"S":"not a number"}}}`))
	})
	order, err := Read(t.Context(), client, "orders", "o1")
	if order == nil || err == nil {
		t.Errorf("order = %+v, error = %v", order, err)
	}
}

func TestReadHonoursTheRequestCancellation(t *testing.T) {
	client := readClient(t, func(http.ResponseWriter, *http.Request) { t.Error("canceled read reached DynamoDB") })
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	order, err := Read(ctx, client, "orders", "o1")
	if order != nil || !errors.Is(err, context.Canceled) {
		t.Errorf("order = %+v, error = %v", order, err)
	}
}
