package downloader

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

type interrupted struct{ data *bytes.Reader }

func (reader interrupted) Read(output []byte) (int, error) {
	n, err := reader.data.Read(output)
	if err == io.EOF {
		err = io.ErrUnexpectedEOF
	}
	return n, err
}

type rangeTransport struct {
	content []byte
	resumed bool
}

func (transport *rangeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	header := make(http.Header)
	header.Set("Content-Type", "image/png")
	header.Set("ETag", "\"fixture-v1\"")
	if value := request.Header.Get("Range"); value != "" {
		start, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(value, "bytes="), "-"))
		if err != nil || start != 1024 || request.Header.Get("If-Range") != "\"fixture-v1\"" {
			return nil, fmt.Errorf("invalid fixture range")
		}
		transport.resumed = true
		header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(transport.content)-1, len(transport.content)))
		return &http.Response{StatusCode: 206, Header: header, ContentLength: int64(len(transport.content) - start),
			Body: io.NopCloser(bytes.NewReader(transport.content[start:])), Request: request}, nil
	}
	return &http.Response{StatusCode: 200, Header: header, ContentLength: int64(len(transport.content)),
		Body: io.NopCloser(interrupted{bytes.NewReader(transport.content[:1024])}), Request: request}, nil
}

func TestVerifiedRangeResume(t *testing.T) {
	png, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "fixtures", "sample.png"))
	if err != nil {
		t.Fatal(err)
	}
	content := append(png, make([]byte, 4096)...)
	transport := &rangeTransport{content: content}
	client := Client()
	client.Transport = transport
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	var progress atomic.Int64
	result, err := Download(context.Background(), client, root, "aeb82f75-38e3-4bcf-bf1a-54ad41d9a268", "dc4a3a2f-6c0a-40fb-8571-e33472b0b6a6", "https://fixture.example/image.png", "image", &progress)
	if err != nil || !transport.resumed {
		t.Fatalf("range resume failed: %v", err)
	}
	actual, err := root.ReadFile(result.Part)
	if err != nil || !bytes.Equal(actual, content) {
		t.Fatal("resumed bytes differ")
	}
}
