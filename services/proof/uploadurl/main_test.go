package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestUploadURLKeepsAuthorizationAndOrderChecks(t *testing.T) {
	for _, tc := range []struct {
		name, item, group, body string
		status                  int
		read                    bool
	}{
		{name: "drivers only", group: "shops", body: `{"contentType":"image/png"}`, status: http.StatusForbidden},
		{name: "invalid content type", group: "drivers", body: `{"contentType":"text/plain"}`, status: http.StatusBadRequest},
		{name: "missing order", group: "drivers", body: `{"contentType":"image/png"}`, item: `{}`, status: http.StatusNotFound, read: true},
		{name: "another driver", group: "drivers", body: `{"contentType":"image/png"}`, item: `{"Item":{"driverId":{"S":"other"},"status":{"S":"ASSIGNED"}}}`, status: http.StatusNotFound, read: true},
		{name: "delivered order", group: "drivers", body: `{"contentType":"image/png"}`, item: `{"Item":{"driverId":{"S":"driver-1"},"status":{"S":"DELIVERED"}}}`, status: http.StatusConflict, read: true},
		{name: "invalid stored order", group: "drivers", body: `{"contentType":"image/png"}`, item: `{"Item":{"dropoffLat":{"S":"invalid"}}}`, status: http.StatusInternalServerError, read: true},
		{name: "assigned order", group: "drivers", body: `{"contentType":"image/png"}`, item: `{"Item":{"driverId":{"S":"driver-1"},"status":{"S":"ASSIGNED"}}}`, status: http.StatusOK, read: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reads := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reads++
				var request struct {
					TableName string
					Key       map[string]struct{ S string }
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				if request.TableName != "orders" || request.Key["pk"].S != "ORDER#o1" || request.Key["sk"].S != "META" {
					t.Errorf("lookup = %+v", request)
				}
				_, _ = w.Write([]byte(tc.item))
			}))
			t.Cleanup(server.Close)
			client := server.Client()
			client.Timeout = time.Second
			cfg := aws.Config{
				Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
				HTTPClient: client, RetryMaxAttempts: 1,
			}
			h := handler{
				db:      dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(server.URL) }),
				presign: s3.NewPresignClient(s3.NewFromConfig(cfg)),
				table:   "orders", bucket: "proof-bucket",
			}
			response, err := h.handle(t.Context(), events.APIGatewayProxyRequest{
				Body: tc.body, PathParameters: map[string]string{"orderId": "o1"},
				RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]any{
					"claims": map[string]any{"sub": "driver-1", "cognito:groups": tc.group},
				}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tc.status || (reads == 1) != tc.read || reads > 1 {
				t.Fatalf("status = %d, reads = %d; want %d, read = %v", response.StatusCode, reads, tc.status, tc.read)
			}
			if tc.status == http.StatusOK {
				var body map[string]string
				if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
					t.Fatal(err)
				}
				signed, err := url.Parse(body["url"])
				if err != nil {
					t.Fatal(err)
				}
				if !strings.HasPrefix(body["key"], "proof/o1/") || !strings.HasSuffix(body["key"], ".png") ||
					signed.Path != "/"+body["key"] || signed.Query().Get("X-Amz-Expires") != "900" {
					t.Errorf("upload = %v", body)
				}
			}
		})
	}
}
