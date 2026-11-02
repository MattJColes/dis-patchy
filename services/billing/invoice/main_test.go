package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestInvoiceBatchReportsBadJobsAndStillWritesTheNextInvoice(t *testing.T) {
	var csv string
	var stored map[string]struct{ S, N string }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".Query"):
			var request struct {
				TableName                 string
				ExpressionAttributeValues map[string]struct{ S string }
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if request.TableName != "billing" || request.ExpressionAttributeValues[":shop"].S != "SHOP#s1" ||
				request.ExpressionAttributeValues[":period"].S != "LINE#2026-10#" {
				t.Errorf("query = %+v", request)
			}
			_, _ = w.Write([]byte(`{"Items":[{"orderId":{"S":"o1"},"amount":{"N":"1.23"}},{"orderId":{"S":"o2"},"amount":{"N":"2.34"}}]}`))
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".PutItem"):
			var request struct {
				TableName string
				Item      map[string]struct{ S, N string }
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if request.TableName != "billing" {
				t.Errorf("table = %q", request.TableName)
			}
			stored = request.Item
			_, _ = w.Write([]byte(`{}`))
		case r.Method == http.MethodPut:
			if r.URL.Path != "/invoices/invoices/s1/2026-10.csv" || r.Header.Get("Content-Type") != "text/csv" {
				t.Errorf("upload = %s, content type = %q", r.URL.Path, r.Header.Get("Content-Type"))
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
			}
			csv = string(body)
		default:
			t.Errorf("unexpected request %s %q", r.Method, r.Header.Get("X-Amz-Target"))
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)
	client := server.Client()
	client.Timeout = time.Second
	cfg := aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
		HTTPClient: client, RetryMaxAttempts: 1,
	}
	h := handler{
		db: dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(server.URL) }),
		s3: s3.NewFromConfig(cfg, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(server.URL)
			o.UsePathStyle = true
		}),
		table: "billing", bucket: "invoices",
	}
	response, err := h.handle(t.Context(), events.SQSEvent{Records: []events.SQSMessage{
		{MessageId: "invalid", Body: "{"},
		{MessageId: "invoice", Body: `{"shopId":"s1","period":"2026-10"}`},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(response.BatchItemFailures, []events.SQSBatchItemFailure{{ItemIdentifier: "invalid"}}) {
		t.Errorf("failures = %+v", response.BatchItemFailures)
	}
	if csv != "order_id,amount\no1,1.23\no2,2.34\nTOTAL,3.57\n" || stored["pk"].S != "SHOP#s1" ||
		stored["sk"].S != "INVOICE#2026-10" || stored["totalCents"].N != "357" ||
		stored["lineCount"].N != "2" || stored["documentKey"].S != "invoices/s1/2026-10.csv" {
		t.Errorf("csv = %q, invoice = %v", csv, stored)
	}
}
