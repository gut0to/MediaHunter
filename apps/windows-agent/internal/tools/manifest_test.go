package tools

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fixtureTransport map[string]string

func (fixtures fixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	content, found := fixtures[request.URL.Path]
	if !found {
		return nil, errors.New("missing manifest fixture")
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(content)), Request: request, Header: make(http.Header)}, nil
}

func TestManifestProtection(t *testing.T) {
	client := &http.Client{Transport: fixtureTransport{
		"/master.m3u8":    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8",
		"/media.m3u8":     "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST",
		"/encrypted.m3u8": "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"secret.key\"\n",
		"/protected.mpd":  "<MPD><Period><AdaptationSet><ContentProtection schemeIdUri=\"urn:uuid:test\"/></AdaptationSet></Period></MPD>",
		"/clear.mpd":      "<MPD><Period><AdaptationSet/></Period></MPD>",
	}}
	for _, scenario := range []struct {
		path, delivery string
		want           error
	}{
		{"/master.m3u8", "hls", nil},
		{"/encrypted.m3u8", "hls", Protected},
		{"/protected.mpd", "dash", Protected},
		{"/clear.mpd", "dash", nil},
	} {
		err := preflight(context.Background(), client, "https://fixture.example"+scenario.path, scenario.delivery)
		if !errors.Is(err, scenario.want) {
			t.Fatalf("%s got %v, want %v", scenario.path, err, scenario.want)
		}
	}
}

func TestMissingToolIsExplicit(t *testing.T) {
	config := Config{}
	if executable(config.YTDLP) {
		t.Fatal("empty executable accepted")
	}
}
