package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

type Client struct {
	Origin string
	Token  string
}

var client = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}}

var ErrLeaseLost = errors.New("lease lost")

func ValidOrigin(raw string) bool {
	address, err := url.Parse(raw)
	if err != nil || address.Hostname() == "" || address.User != nil || address.Path != "" ||
		address.RawQuery != "" || address.ForceQuery || address.Fragment != "" || address.Opaque != "" {
		return false
	}
	return address.Scheme == "https" ||
		(address.Scheme == "http" && (address.Hostname() == "localhost" || address.Hostname() == "127.0.0.1"))
}

type Lease struct {
	ID                   string
	LeaseID              string
	URL                  string
	MediaType            string
	DestinationProfileID string
}

type Report struct {
	LeaseID         string `json:"leaseId"`
	BytesDownloaded int64  `json:"bytesDownloaded"`
	ErrorCode       string `json:"errorCode,omitempty"`
}

func (c Client) Post(ctx context.Context, path string, input, output any) error {
	if !ValidOrigin(c.Origin) {
		return errors.New("invalid Hub origin")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin+"/api/v1"+path, bytes.NewReader(body))
	if err != nil {
		return errors.New("invalid Hub request")
	}
	request.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		request.Header.Set("Authorization", "Bearer "+c.Token)
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("Hub unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode == 409 {
		return ErrLeaseLost
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("Hub rejected the request")
	}
	if output == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(output); err != nil {
		return errors.New("invalid Hub response")
	}
	return nil
}
