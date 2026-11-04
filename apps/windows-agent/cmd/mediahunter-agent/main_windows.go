package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/config"
	"mediahunter/agent/internal/downloader"
)

type settings struct {
	Destination    string
	Origin         string
	ID             string
	ProtectedToken []byte
}

var codePattern = regexp.MustCompile("^[0-9a-f]{16}$")
var tokenPattern = regexp.MustCompile("^[0-9a-f]{64}$")

func save(path string, cfg settings) error {
	file, err := os.CreateTemp(filepath.Dir(path), "settings-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(cfg)
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: mediahunter-agent configure <folder> | pair <Hub origin> | start | status | unpair")
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return errors.New("LOCALAPPDATA is unavailable")
	}
	directory := filepath.Join(base, "MediaHunter")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	path := filepath.Join(directory, "settings.json")
	var cfg settings
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return errors.New("invalid settings file")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	switch args[0] {
	case "configure":
		if len(args) != 2 {
			return errors.New("provide an existing local folder")
		}
		dest, err := filepath.Abs(args[1])
		if err != nil || len(filepath.VolumeName(dest)) != 2 {
			return errors.New("provide an existing local drive folder")
		}
		info, err := os.Stat(dest)
		if err != nil || !info.IsDir() {
			return errors.New("destination must be an existing folder")
		}
		cfg.Destination = dest
		return save(path, cfg)
	case "pair":
		if len(args) != 2 || !api.ValidOrigin(args[1]) {
			return errors.New("provide a private HTTPS Hub origin without a trailing slash")
		}
		fmt.Print("Pairing code: ")
		code, err := bufio.NewReader(os.Stdin).ReadString('\n')
		code = strings.TrimSpace(code)
		if (err != nil && code == "") || !codePattern.MatchString(code) {
			return errors.New("invalid pairing code")
		}
		var response struct{ ID, Token string }
		client := api.Client{Origin: args[1]}
		if err := client.Post(ctx, "/pairing/claim", map[string]string{"kind": "windows_agent", "name": "Windows agent", "code": code}, &response); err != nil {
			return err
		}
		if !downloader.ValidID(response.ID) || !tokenPattern.MatchString(response.Token) {
			return errors.New("invalid pairing response")
		}
		cfg.ProtectedToken, err = config.Protect([]byte(response.Token))
		if err != nil {
			return err
		}
		cfg.ID, cfg.Origin = response.ID, client.Origin
		if err := save(path, cfg); err != nil {
			return err
		}
		fmt.Println("Agent ID:", cfg.ID)
		return nil
	case "unpair":
		cfg.ID, cfg.Origin, cfg.ProtectedToken = "", "", nil
		return save(path, cfg)
	case "status":
		fmt.Printf("Paired: %t\nDestination configured: %t\n", cfg.ID != "", cfg.Destination != "")
		return nil
	case "start":
		if cfg.ID == "" || cfg.Destination == "" {
			return errors.New("configure a destination and pair this agent first")
		}
		token, err := config.Unprotect(cfg.ProtectedToken)
		if err != nil {
			return err
		}
		root, err := os.OpenRoot(cfg.Destination)
		if err != nil {
			return errors.New("could not open destination")
		}
		defer root.Close()
		poll(ctx, api.Client{Origin: cfg.Origin, Token: string(token)}, root)
		return nil
	default:
		return errors.New("unknown command")
	}
}

func poll(ctx context.Context, hub api.Client, root *os.Root) {
	media := downloader.Client()
	defer media.CloseIdleConnections()
	fmt.Println("Agent running. Press Ctrl+C to stop.")
	for ctx.Err() == nil {
		var lease *api.Lease
		err := hub.Post(ctx, "/agent/jobs/lease", struct{}{}, &lease)
		if err == nil && lease != nil && lease.DestinationProfileID == "default" && downloader.ValidID(lease.ID) && downloader.ValidID(lease.LeaseID) {
			handle(ctx, hub, media, root, *lease)
			continue
		}
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second):
		}
	}
}

func handle(ctx context.Context, hub api.Client, media *http.Client, root *os.Root, lease api.Lease) {
	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	path := "/agent/jobs/" + lease.ID
	var progress atomic.Int64
	report := func() api.Report {
		return api.Report{LeaseID: lease.LeaseID, BytesDownloaded: progress.Load()}
	}
	if hub.Post(jobCtx, path+"/heartbeat", report(), nil) != nil {
		return
	}

	stop := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(4 * time.Second)
		defer ticker.Stop()
		lastOK := time.Now()
		for {
			select {
			case <-stop:
				return
			case <-jobCtx.Done():
				return
			case <-ticker.C:
				err := hub.Post(jobCtx, path+"/heartbeat", report(), nil)
				if err == nil {
					lastOK = time.Now()
				}
				if errors.Is(err, api.ErrLeaseLost) || time.Since(lastOK) > 25*time.Second {
					cancel()
					return
				}
			}
		}
	}()
	result, err := downloader.Download(jobCtx, media, root, lease.ID, lease.LeaseID, lease.URL, lease.MediaType, &progress)
	if result.Part != "" {
		defer root.Remove(result.Part)
	}
	close(stop)
	<-stopped
	if jobCtx.Err() != nil {
		return
	}
	if err != nil {
		sendFailure(jobCtx, hub, path, report(), err)
		return
	}
	if hub.Post(jobCtx, path+"/heartbeat", report(), nil) != nil {
		return
	}
	published, err := downloader.Publish(root, result)
	if err != nil {
		sendFailure(jobCtx, hub, path, report(), err)
		return
	}
	for attempt := 0; attempt < 3; attempt++ {
		err = hub.Post(jobCtx, path+"/complete", report(), nil)
		if err == nil {
			return
		}
		if errors.Is(err, api.ErrLeaseLost) {
			if published {
				_ = root.Remove(result.Final)
			}
			return
		}
		if jobCtx.Err() != nil {
			return
		}
	}
}

func sendFailure(ctx context.Context, hub api.Client, path string, report api.Report, err error) {
	var failure downloader.Failure
	if !errors.As(err, &failure) {
		failure = downloader.Failed
	}
	report.ErrorCode = string(failure)
	_ = hub.Post(ctx, path+"/fail", report, nil)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
