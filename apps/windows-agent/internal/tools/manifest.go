package tools

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"mediahunter/agent/internal/downloader"
)

const manifestLimit = 1 << 20

func preflight(ctx context.Context, client *http.Client, source, delivery string) error {
	visited := make(map[string]bool)
	var inspect func(string) error
	inspect = func(raw string) error {
		if visited[raw] {
			return nil
		}
		if len(visited) >= 32 {
			return Unsupported
		}
		visited[raw] = true
		if _, err := downloader.CheckSource(raw); err != nil {
			return err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		if err != nil {
			return downloader.Unsafe
		}
		response, err := client.Do(request)
		if err != nil {
			if errors.Is(err, downloader.Unsafe) {
				return downloader.Unsafe
			}
			return downloader.Failed
		}
		defer response.Body.Close()
		if response.StatusCode == 401 || response.StatusCode == 403 || response.StatusCode == 410 {
			return downloader.Expired
		}
		if response.StatusCode != 200 {
			return downloader.HTTPError
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, manifestLimit+1))
		if err != nil || len(body) > manifestLimit {
			return Unsupported
		}
		text := string(body)
		upper := strings.ToUpper(text)
		if delivery == "dash" {
			if !strings.Contains(upper, "<MPD") {
				return Unsupported
			}
			if strings.Contains(upper, "CONTENTPROTECTION") {
				return Protected
			}
			return nil
		}
		if !strings.HasPrefix(strings.TrimSpace(text), "#EXTM3U") {
			return Unsupported
		}
		var nextVariant bool
		for _, rawLine := range strings.Split(text, "\n") {
			line := strings.TrimSpace(rawLine)
			normalized := strings.ToUpper(line)
			if strings.HasPrefix(normalized, "#EXT-X-KEY:") || strings.HasPrefix(normalized, "#EXT-X-SESSION-KEY:") {
				if strings.TrimSpace(strings.SplitN(strings.SplitN(normalized, ":", 2)[1], ",", 2)[0]) != "METHOD=NONE" {
					return Protected
				}
			}
			if strings.HasPrefix(normalized, "#EXT-X-STREAM-INF:") {
				nextVariant = true
				continue
			}
			target := ""
			if nextVariant && line != "" && !strings.HasPrefix(line, "#") {
				target, nextVariant = line, false
			} else if strings.HasPrefix(normalized, "#EXT-X-MEDIA:") || strings.HasPrefix(normalized, "#EXT-X-I-FRAME-STREAM-INF:") {
				if _, suffix, ok := strings.Cut(line, "URI=\""); ok {
					target, _, _ = strings.Cut(suffix, "\"")
				}
			}
			if target != "" {
				reference, err := url.Parse(target)
				if err != nil {
					return Unsupported
				}
				if err := inspect(response.Request.URL.ResolveReference(reference).String()); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return inspect(source)
}
