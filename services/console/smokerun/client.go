package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// call makes one API request and fails on a non-2xx, quoting the API's error.
func call(ctx context.Context, method, url, token string, body any, headers map[string]string) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("%s %s: %s %s", method, trimQuery(url), resp.Status, strings.TrimSpace(string(out)))
	}
	return out, nil
}

// trimQuery keeps presigned URL signatures out of error messages.
func trimQuery(url string) string {
	before, _, _ := strings.Cut(url, "?")
	return before
}

var errNotYet = errors.New("not yet")

// waitFor retries check every 3 seconds until it stops returning errNotYet.
func waitFor(ctx context.Context, timeout time.Duration, what string, check func() error) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		err := check()
		if !errors.Is(err, errNotYet) {
			return err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out after %s waiting for %s", timeout, what)
		case <-time.After(3 * time.Second):
		}
	}
}
