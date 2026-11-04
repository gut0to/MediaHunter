package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/downloader"
)

type fixtureTransport struct{ origin string }

func (transport fixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	forwarded, err := http.NewRequestWithContext(request.Context(), request.Method, transport.origin+request.URL.RequestURI(), nil)
	if err != nil {
		return nil, err
	}
	return http.DefaultTransport.RoundTrip(forwarded)
}

func TestRealHubAndWindowsTransfer(t *testing.T) {
	origin := os.Getenv("MEDIAHUNTER_TEST_HUB")
	if origin == "" {
		t.Skip("real Hub integration environment not configured")
	}
	claim := func(kind, code string) (api.Client, string) {
		t.Helper()
		var credentials struct{ ID, Token string }
		anonymous := api.Client{Origin: origin}
		if err := anonymous.Post(context.Background(), "/pairing/claim", map[string]string{"kind": kind, "name": "Integration fixture", "code": code}, &credentials); err != nil {
			t.Fatal(err)
		}
		return api.Client{Origin: origin, Token: credentials.Token}, credentials.ID
	}
	extension, _ := claim("extension", os.Getenv("MEDIAHUNTER_TEST_EXTENSION_CODE"))
	agent, agentID := claim("windows_agent", os.Getenv("MEDIAHUNTER_TEST_AGENT_CODE"))
	var scan struct {
		ID           string
		CandidateIDs []string
	}
	err := extension.Post(context.Background(), "/scans", map[string]any{
		"pageOrigin": "https://fixture.example", "candidates": []map[string]any{{
			"url": "https://fixture.example/sample.png", "mediaType": "image", "source": "dom", "format": "png", "width": 64, "height": 48,
		}}}, &scan)
	if err != nil || len(scan.CandidateIDs) != 1 {
		t.Fatalf("scan registration failed: %v", err)
	}
	var added struct{ ID, State string }
	err = extension.Post(context.Background(), "/jobs", map[string]string{"candidateId": scan.CandidateIDs[0], "targetAgentId": agentID, "idempotencyKey": "aeb82f75-38e3-4bcf-bf1a-54ad41d9a268"}, &added)
	if err != nil {
		t.Fatal(err)
	}
	var lease *api.Lease
	if err := agent.Post(context.Background(), "/agent/jobs/lease", map[string]any{"profiles": []string{"default"}}, &lease); err != nil || lease == nil {
		t.Fatalf("lease failed: %v", err)
	}
	fixtureRoot := filepath.Join("..", "..", "..", "..", "fixtures")
	fixture := httptest.NewServer(http.FileServer(http.Dir(fixtureRoot)))
	defer fixture.Close()
	media := downloader.Client()
	media.Transport = fixtureTransport{origin: fixture.URL}
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	var progress atomic.Int64
	result, err := downloader.Download(context.Background(), media, root, lease.ID, lease.LeaseID, lease.URL, lease.MediaType, &progress)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Remove(result.Part)
	if _, err := downloader.Publish(root, result); err != nil {
		t.Fatal(err)
	}
	report := api.Report{LeaseID: lease.LeaseID, BytesDownloaded: result.Bytes}
	if err := agent.Post(context.Background(), "/agent/jobs/"+lease.ID+"/complete", report, nil); err != nil {
		t.Fatal(err)
	}
	actual, err := root.ReadFile(result.Final)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := os.ReadFile(filepath.Join(fixtureRoot, "sample.png"))
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatal("download differs from fixture")
	}
	request, _ := http.NewRequest(http.MethodGet, origin+"/api/v1/jobs", nil)
	request.Header.Set("Authorization", "Bearer "+extension.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	var jobs []struct{ ID, State string }
	if json.Unmarshal(data, &jobs) != nil || len(jobs) != 1 || jobs[0].State != "completed" {
		t.Fatal("Hub did not acknowledge the saved file")
	}
}
