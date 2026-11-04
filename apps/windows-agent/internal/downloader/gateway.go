package downloader

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
)

// StartGateway gives an external extractor a loopback proxy. All connections
// are pinned to DNS results verified by the same policy as direct downloads.
func StartGateway(ctx context.Context) (string, func(), error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", nil, err
	}
	transport := Client().Transport.(*http.Transport)
	server := &http.Server{
		ReadHeaderTimeout: 8 * time.Second,
		IdleTimeout:       20 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodConnect {
				target := &url.URL{Scheme: "https", Host: r.Host}
				if checkURL(target) != nil || target.Port() != "443" {
					http.Error(w, "Blocked destination", 403)
					return
				}
				conn, err := transport.DialContext(ctx, "tcp", r.Host)
				if err != nil {
					status := 502
					if errors.Is(err, Unsafe) {
						status = 403
					}
					http.Error(w, "Connection unavailable", status)
					return
				}
				defer conn.Close()
				client, rw, err := http.NewResponseController(w).Hijack()
				if err != nil {
					return
				}
				defer client.Close()
				stop := context.AfterFunc(ctx, func() { _ = client.Close(); _ = conn.Close() })
				defer stop()
				_, _ = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
				if rw.Flush() != nil {
					return
				}
				done := make(chan struct{})
				go func() {
					_, _ = io.Copy(conn, rw)
					_ = conn.Close()
					close(done)
				}()
				_, _ = io.Copy(client, conn)
				_ = client.Close()
				<-done
				return
			}
			if checkURL(r.URL) != nil || (r.Method != "GET" && r.Method != "HEAD") {
				http.Error(w, "Blocked request", 403)
				return
			}
			request := r.Clone(ctx)
			request.RequestURI = ""
			request.Header.Del("Proxy-Authorization")
			request.Header.Del("Proxy-Connection")
			request.Header.Del("Cookie")
			request.Header.Del("Authorization")
			response, err := transport.RoundTrip(request)
			if err != nil {
				http.Error(w, "Origin unavailable", 502)
				return
			}
			defer response.Body.Close()
			for key, values := range response.Header {
				if key == "Connection" || key == "Proxy-Authenticate" || key == "Transfer-Encoding" {
					continue
				}
				for _, value := range values {
					w.Header().Add(key, value)
				}
			}
			w.WriteHeader(response.StatusCode)
			_, _ = io.Copy(w, response.Body)
		}),
	}
	go func() { _ = server.Serve(listener) }()
	return "http://" + listener.Addr().String(), func() {
		_ = server.Close()
		transport.CloseIdleConnections()
	}, nil
}

func CheckSource(source string) (*url.URL, error) {
	target, err := url.Parse(source)
	if err != nil || checkURL(target) != nil {
		return nil, Unsafe
	}
	return target, nil
}
