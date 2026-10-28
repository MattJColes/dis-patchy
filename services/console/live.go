// Package console publishes what happens across the system to the live
// console's AppSync Events channel.
package console

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

// Channel is where every live event goes; the console subscribes to it.
const Channel = "/live/system"

// AppSync Events accepts at most five events per publish.
const maxBatch = 5

// Event is the one shape the console renders. Kind is the bus detail-type,
// "WorkflowStatus", "Ping" or "SmokeStep".
type Event struct {
	Kind   string          `json:"kind"`
	At     time.Time       `json:"at"`
	Detail json.RawMessage `json:"detail"`
}

type Publisher struct {
	URL    string // https://<http dns>/event
	Region string
	Creds  aws.CredentialsProvider
	Client *http.Client
}

func NewPublisher(httpDNS, region string, creds aws.CredentialsProvider) Publisher {
	return Publisher{
		URL:    "https://" + httpDNS + "/event",
		Region: region,
		Creds:  creds,
		Client: &http.Client{Timeout: 5 * time.Second},
	}
}

// Publish sends events in batches. A dropped live event only costs an
// animation, so callers log failures rather than retrying.
func (p Publisher) Publish(ctx context.Context, events ...Event) error {
	for start := 0; start < len(events); start += maxBatch {
		if err := p.publishBatch(ctx, events[start:min(start+maxBatch, len(events))]); err != nil {
			return err
		}
	}
	return nil
}

func (p Publisher) publishBatch(ctx context.Context, batch []Event) error {
	encoded := make([]string, len(batch))
	for i, e := range batch {
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		encoded[i] = string(b)
	}
	body, err := json.Marshal(map[string]any{"channel": Channel, "events": encoded})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	creds, err := p.Creds.Retrieve(ctx)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(body)
	if err := v4.NewSigner().SignHTTP(ctx, creds, req, hex.EncodeToString(hash[:]), "appsync", p.Region, time.Now()); err != nil {
		return err
	}

	resp, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("publish: %s: %s", resp.Status, msg)
	}
	return nil
}
