package downloader

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

var retryable = errors.New("temporary origin response")

func Download(ctx context.Context, client *http.Client, root *os.Root, id, lease, source, mediaType string, progress *atomic.Int64) (Result, error) {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		progress.Store(0)
		result, err := downloadOnce(ctx, client, root, id, lease, source, mediaType, progress)
		if err == nil {
			return result, nil
		}
		last = err
		if ctx.Err() != nil || (!errors.Is(err, Failed) && !errors.Is(err, retryable)) {
			break
		}
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return Result{}, Failed
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}
	}
	if errors.Is(last, retryable) {
		last = HTTPError
	}
	return Result{}, last
}
