package downloader

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const MaxBytes int64 = 10 << 30

type Failure string

func (f Failure) Error() string { return string(f) }

const (
	HTTPError   Failure = "HTTP_ERROR"
	Expired     Failure = "EXPIRED_URL"
	Unsafe      Failure = "UNSAFE_SOURCE"
	Invalid     Failure = "INVALID_MEDIA"
	TooLarge    Failure = "SIZE_LIMIT"
	Destination Failure = "DESTINATION_ERROR"
	Failed      Failure = "DOWNLOAD_FAILED"
)

var special = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("168.63.129.16/32"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/3"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() ||
		(ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip)) {
		return false
	}
	for _, prefix := range special {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func checkURL(url *url.URL) error {
	if (url.Scheme != "https" && url.Scheme != "http") || url.Hostname() == "" || url.User != nil {
		return Unsafe
	}
	host := strings.TrimSuffix(strings.ToLower(url.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || !strings.ContainsAny(host, ".:") {
		return Unsafe
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicIP(ip) {
		return Unsafe
	}
	if port := url.Port(); port != "" && (url.Scheme == "https" && port != "443" || url.Scheme == "http" && port != "80") {
		return Unsafe
	}
	return nil
}

func Client() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		ResponseHeaderTimeout: 15 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		IdleConnTimeout:       30 * time.Second,
		DisableCompression:    true,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, Unsafe
			}
			addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			for _, ip := range addresses {
				if !publicIP(ip) {
					return nil, Unsafe
				}
			}
			var last error = Failed
			for _, ip := range addresses {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, last
		},
	}
	return &http.Client{Transport: transport, Timeout: 2 * time.Hour, CheckRedirect: func(request *http.Request, prior []*http.Request) error {
		if len(prior) >= 5 {
			return Unsafe
		}
		request.Header.Del("Referer")
		return checkURL(request.URL)
	}}
}

var jobID = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

func ValidID(id string) bool { return jobID.MatchString(id) }

type Result struct {
	Part   string
	Final  string
	Digest string
	Bytes  int64
}

var extensions = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
	"image/webp": ".webp", "image/avif": ".avif", "image/bmp": ".bmp",
	"image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
	"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
	"video/x-m4v": ".m4v", "video/ogg": ".ogv",
}

func downloadOnce(ctx context.Context, client *http.Client, root *os.Root, id, lease, source, mediaType string, progress *atomic.Int64, limit int64, total *atomic.Int64) (Result, error) {
	if !ValidID(id) || !ValidID(lease) {
		return Result{}, Destination
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil || checkURL(request.URL) != nil {
		return Result{}, Unsafe
	}
	request.Header.Set("Accept-Encoding", "identity")
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, Unsafe) {
			return Result{}, Unsafe
		}
		return Result{}, Failed
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 || response.StatusCode == 410 {
		return Result{}, Expired
	}
	if response.StatusCode == 429 || response.StatusCode >= 500 {
		return Result{}, retryable
	}
	if response.StatusCode != 200 {
		return Result{}, HTTPError
	}
	if total != nil {
		total.Store(response.ContentLength)
	}
	if response.ContentLength > limit {
		return Result{}, TooLarge
	}
	if response.Header.Get("Content-Encoding") != "" && response.Header.Get("Content-Encoding") != "identity" {
		return Result{}, Invalid
	}
	contentType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	var prefix [512]byte
	size, err := io.ReadFull(response.Body, prefix[:])
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return Result{}, Failed
	}
	detected := http.DetectContentType(prefix[:size])
	if size == 0 || strings.HasPrefix(detected, "text/") {
		return Result{}, Invalid
	}
	// Where signatures are recognized, reject a conflicting declared type.
	if strings.HasPrefix(detected, "image/") || strings.HasPrefix(detected, "video/") {
		if contentType == "" || contentType == "application/octet-stream" {
			contentType = detected
		}
		if !strings.HasPrefix(detected, mediaType+"/") {
			return Result{}, Invalid
		}
	}
	ext := extensions[contentType]
	if ext == "" || !strings.HasPrefix(contentType, mediaType+"/") {
		return Result{}, Invalid
	}

	result := Result{Part: id + "-" + lease + ".part", Final: id + ext}
	file, err := root.OpenFile(result.Part, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return Result{}, Destination
	}
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = root.Remove(result.Part)
		}
	}()
	digest := sha256.New()
	writer := io.MultiWriter(file, digest, progressWriter{progress})
	reader := io.MultiReader(bytes.NewReader(prefix[:size]), response.Body)
	result.Bytes, err = io.Copy(writer, io.LimitReader(reader, limit+1))
	if err != nil && ctx.Err() == nil && result.Bytes > 0 && result.Bytes < limit {
		validator := response.Header.Get("ETag")
		if strings.HasPrefix(validator, "W/") {
			validator = ""
		}
		if validator == "" {
			validator = response.Header.Get("Last-Modified")
		}
		if validator != "" && response.ContentLength > result.Bytes {
			resume, makeErr := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
			if makeErr == nil {
				resume.Header.Set("Range", "bytes="+strconv.FormatInt(result.Bytes, 10)+"-")
				resume.Header.Set("If-Range", validator)
				resume.Header.Set("Accept-Encoding", "identity")
				continued, requestErr := client.Do(resume)
				if requestErr == nil {
					expected := fmt.Sprintf("bytes %d-%d/%d", result.Bytes, response.ContentLength-1, response.ContentLength)
					if continued.StatusCode == 206 && continued.Header.Get("Content-Range") == expected &&
						(continued.Header.Get("ETag") == "" || continued.Header.Get("ETag") == response.Header.Get("ETag")) {
						var copied int64
						copied, err = io.Copy(writer, io.LimitReader(continued.Body, limit-result.Bytes+1))
						result.Bytes += copied
					}
					_ = continued.Body.Close()
				}
			}
		}
	}
	if err != nil || ctx.Err() != nil {
		return Result{}, Failed
	}
	if result.Bytes > limit {
		return Result{}, TooLarge
	}
	if response.ContentLength >= 0 && response.ContentLength != result.Bytes {
		return Result{}, Failed
	}
	if file.Sync() != nil || file.Close() != nil {
		return Result{}, Destination
	}
	result.Digest = hex.EncodeToString(digest.Sum(nil))
	keep = true
	return result, nil
}

type progressWriter struct{ total *atomic.Int64 }

func (writer progressWriter) Write(data []byte) (int, error) {
	writer.total.Add(int64(len(data)))
	return len(data), nil
}

// Publish atomically and without replacing an existing path. A retry may see
// the file published by a prior attempt whose acknowledgement was lost.
func Publish(root *os.Root, result Result) (bool, error) {
	if err := root.Link(result.Part, result.Final); err == nil {
		return true, nil
	} else if !os.IsExist(err) {
		return false, Destination
	}
	info, err := root.Lstat(result.Final)
	if err != nil || !info.Mode().IsRegular() || info.Size() != result.Bytes {
		return false, Destination
	}
	file, err := root.Open(result.Final)
	if err != nil {
		return false, Destination
	}
	defer file.Close()
	digest := sha256.New()
	n, err := io.Copy(digest, io.LimitReader(file, result.Bytes+1))
	if err != nil || n != result.Bytes || hex.EncodeToString(digest.Sum(nil)) != result.Digest {
		return false, Destination
	}
	return false, nil
}
