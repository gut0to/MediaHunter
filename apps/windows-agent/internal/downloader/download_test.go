package downloader

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

type localTransport struct {
	fixture string
}

func (transport localTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	local, err := http.NewRequestWithContext(request.Context(), request.Method, transport.fixture+request.URL.Path, nil)
	if err != nil {
		return nil, err
	}
	return http.DefaultTransport.RoundTrip(local)
}

func TestDownloadAndPublish(t *testing.T) {
	const id = "aeb82f75-38e3-4bcf-bf1a-54ad41d9a268"
	const lease = "dc4a3a2f-6c0a-40fb-8571-e33472b0b6a6"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/missing" {
			http.NotFound(w, r)
			return
		}
		file := strings.TrimPrefix(r.URL.Path, "/")
		if file == "truncated" {
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Length", "1000")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nshort"))
			return
		}
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://127.0.0.1/private", 302)
			return
		}
		http.ServeFile(w, r, filepath.Join("..", "..", "..", "..", "fixtures", file))
	}))
	defer server.Close()
	client := Client()
	client.Transport = localTransport{fixture: server.URL}
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, scenario := range []struct {
		name, path, media string
		want              error
	}{
		{"image", "/sample.png", "image", nil},
		{"jpeg", "/sample.jpg", "image", nil},
		{"video", "/sample.mp4", "video", nil},
		{"missing", "/missing", "image", HTTPError},
		{"truncated", "/truncated", "image", Failed},
		{"redirect", "/redirect", "image", Unsafe},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var progress atomic.Int64
			result, err := Download(context.Background(), client, root, id, lease, "https://fixture.example"+scenario.path, scenario.media, &progress)
			if !errors.Is(err, scenario.want) {
				t.Fatalf("got %v, want %v", err, scenario.want)
			}
			if err != nil {
				files, _ := filepath.Glob(filepath.Join(dir, "*.part"))
				if len(files) != 0 {
					t.Fatalf("partial files left: %v", files)
				}
				return
			}
			defer root.Remove(result.Part)
			defer root.Remove(result.Final)
			if result.Bytes != progress.Load() {
				t.Fatal("progress mismatch")
			}
			created, err := Publish(root, result)
			if err != nil || !created {
				t.Fatalf("publish: %t %v", created, err)
			}
			created, err = Publish(root, result)
			if err != nil || created {
				t.Fatalf("repeat publish: %t %v", created, err)
			}
			actual, err := root.ReadFile(result.Final)
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "fixtures", scenario.path[1:]))
			if err != nil || string(actual) != string(want) {
				t.Fatal("saved bytes differ from fixture")
			}
		})
	}
	var progress atomic.Int64
	if _, err := Download(context.Background(), client, root, "../outside", lease, "https://fixture.example/sample.png", "image", &progress); !errors.Is(err, Destination) {
		t.Fatal("path traversal accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Download(ctx, client, root, id, lease, "https://fixture.example/sample.png", "image", &progress); err == nil {
		t.Fatal("canceled request completed")
	}
}

func TestPublicIP(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.100", "::ffff:192.168.1.1", "64:ff9b::a00:1", "fe80::1"} {
		if publicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("allowed %s", raw)
		}
	}
	if !publicIP(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("blocked public IPv4")
	}
}
