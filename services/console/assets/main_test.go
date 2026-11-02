package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MattJColes/dis-patchy/services/console"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func assetRequest(groups string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{RequestContext: events.APIGatewayProxyRequestContext{
		Authorizer: map[string]any{"claims": map[string]any{"cognito:groups": groups}},
	}}
}

func TestAssetEndpointRejectsNonOpsUsers(t *testing.T) {
	for _, group := range []string{"", "[shops]", "[drivers]"} {
		t.Run(group, func(t *testing.T) {
			response, err := (handler{}).handle(t.Context(), assetRequest(group))
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusForbidden {
				t.Errorf("status = %d", response.StatusCode)
			}
		})
	}
}

func assetHandler(t *testing.T, status int, body string) handler {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	return handler{
		db: dynamodb.NewFromConfig(aws.Config{
			Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
			HTTPClient: client, RetryMaxAttempts: 1, BaseEndpoint: aws.String(server.URL),
		}),
		table: "console", driversTable: "drivers",
	}
}

func TestOpsUsersCanReadTheCatalogBeforeFleetPreparation(t *testing.T) {
	response, err := assetHandler(t, http.StatusOK, `{}`).handle(t.Context(), assetRequest("[ops]"))
	if err != nil {
		t.Fatal(err)
	}
	var fleet console.Fleet
	if err := json.Unmarshal([]byte(response.Body), &fleet); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || len(fleet.Shops) != 3 || len(fleet.Drivers) != 0 {
		t.Errorf("response = %+v, fleet = %+v", response, fleet)
	}
}

func TestUnavailableAssetStorageDoesNotReturnASuccessfulEmptyFleet(t *testing.T) {
	response, err := assetHandler(t, http.StatusServiceUnavailable, `{"__type":"ServiceUnavailableException","message":"unavailable"}`).
		handle(t.Context(), assetRequest("[ops]"))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusInternalServerError {
		t.Errorf("response = %+v", response)
	}
}
