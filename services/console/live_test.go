package console

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
)

type published struct {
	auth    string
	channel string
	events  []Event
}

func recorder(t *testing.T, status int) (*httptest.Server, *[]published) {
	t.Helper()
	var got []published
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Channel string   `json:"channel"`
			Events  []string `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		p := published{auth: r.Header.Get("Authorization"), channel: body.Channel}
		for _, raw := range body.Events {
			var e Event
			if err := json.Unmarshal([]byte(raw), &e); err != nil {
				t.Fatal(err)
			}
			p.events = append(p.events, e)
		}
		got = append(got, p)
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func publisher(url string) Publisher {
	return Publisher{
		URL:    url,
		Region: "us-east-1",
		Creds:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider("AKID", "SECRET", "")),
		Client: &http.Client{Timeout: time.Second},
	}
}

func events(n int) []Event {
	out := make([]Event, n)
	for i := range out {
		out[i] = Event{Kind: "Ping", At: time.Unix(int64(i), 0).UTC(), Detail: json.RawMessage(`{}`)}
	}
	return out
}

func TestPublishSignsAndSendsToTheSystemChannel(t *testing.T) {
	srv, got := recorder(t, http.StatusOK)

	if err := publisher(srv.URL).Publish(context.Background(), events(1)...); err != nil {
		t.Fatal(err)
	}

	if len(*got) != 1 {
		t.Fatalf("got %d requests, want 1", len(*got))
	}
	p := (*got)[0]
	if !strings.HasPrefix(p.auth, "AWS4-HMAC-SHA256 Credential=AKID/") || !strings.Contains(p.auth, "/appsync/aws4_request") {
		t.Errorf("not SigV4-signed for appsync: %q", p.auth)
	}
	if p.channel != Channel || p.events[0].Kind != "Ping" {
		t.Errorf("got channel %q events %+v", p.channel, p.events)
	}
}

func TestPublishBatchesInFives(t *testing.T) {
	srv, got := recorder(t, http.StatusOK)

	if err := publisher(srv.URL).Publish(context.Background(), events(12)...); err != nil {
		t.Fatal(err)
	}

	var sizes []int
	for _, p := range *got {
		sizes = append(sizes, len(p.events))
	}
	if len(sizes) != 3 || sizes[0] != 5 || sizes[1] != 5 || sizes[2] != 2 {
		t.Errorf("batch sizes = %v, want [5 5 2]", sizes)
	}
}

func TestPublishFailsOnNon2xx(t *testing.T) {
	srv, _ := recorder(t, http.StatusUnauthorized)

	if err := publisher(srv.URL).Publish(context.Background(), events(1)...); err == nil {
		t.Fatal("want an error for a 401")
	}
}
