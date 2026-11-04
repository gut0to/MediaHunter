package tools

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"mediahunter/agent/internal/api"
)

type remapTransport struct{ origin string }

func (transport remapTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone, err := http.NewRequestWithContext(request.Context(), request.Method, transport.origin+request.URL.RequestURI(), nil)
	if err != nil {
		return nil, err
	}
	clone.Header = request.Header.Clone()
	response, err := http.DefaultTransport.RoundTrip(clone)
	if response != nil {
		response.Request = request
	}
	return response, err
}

func TestAdaptiveMediaWithInstalledTools(t *testing.T) {
	config := Config{YTDLP: os.Getenv("MEDIAHUNTER_TEST_YTDLP"), FFmpeg: os.Getenv("MEDIAHUNTER_TEST_FFMPEG")}
	if !executable(config.YTDLP) || !executable(config.FFmpeg) {
		t.Skip("optional yt-dlp and FFmpeg integration executables not configured")
	}
	fixture := httptest.NewServer(http.FileServer(http.Dir(filepath.Join("..", "..", "..", "..", "fixtures"))))
	defer fixture.Close()
	client := &http.Client{Transport: remapTransport{origin: fixture.URL}}
	// Only this test maps a synthetic public hostname to a loopback fixture.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method == "CONNECT" || request.URL.Hostname() != "fixture.example" {
			http.Error(w, "unexpected fixture request", 403)
			return
		}
		clone := request.Clone(request.Context())
    clone.RequestURI = ""
    response, err := client.Do(clone)
		if err != nil {
			http.Error(w, "fixture unavailable", 502)
			return
		}
		defer response.Body.Close()
		for key, values := range response.Header {
			if strings.EqualFold(key, "Transfer-Encoding") {
				continue
			}
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	defer proxy.Close()
	gateway := func(context.Context) (string, func(), error) { return proxy.URL, func() {}, nil }
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, fixtureCase := range []struct{ delivery, path string }{
		{"hls", "/hls/master.m3u8"}, {"dash", "/dash/manifest.mpd"},
	} {
		t.Run(fixtureCase.delivery, func(t *testing.T) {
			lease := api.Lease{ID: "aeb82f75-38e3-4bcf-bf1a-54ad41d9a268", LeaseID: "dc4a3a2f-6c0a-40fb-8571-e33472b0b6a6",
				URL: "http://fixture.example" + fixtureCase.path, MediaType: "video", Delivery: fixtureCase.delivery, Purpose: "probe"}
			var progress atomic.Int64
			_, formats, err := config.run(context.Background(), client, root, lease, &progress, gateway)
			if err != nil || len(formats) == 0 {
				t.Fatalf("format inspection failed: %v", err)
			}
			lease.Purpose = "download"
			result, _, err := config.run(context.Background(), client, root, lease, &progress, gateway)
			if err != nil || result.Bytes == 0 {
				t.Fatalf("adaptive download failed: %v", err)
			}
			_ = root.Remove(result.Part)
		})
	}
}
