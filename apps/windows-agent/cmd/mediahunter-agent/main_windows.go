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
	"sync"
	"sync/atomic"
	"time"

	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/config"
	"mediahunter/agent/internal/downloader"
	"mediahunter/agent/internal/tools"
)

type settings struct {
	Destination    string
	Profiles       map[string]string
	Tools          tools.Config
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
		if len(args) < 2 || len(args) > 3 {
			return errors.New("provide an existing local folder and optional profile ID")
		}
		dest, err := filepath.Abs(args[1])
		if err != nil || len(filepath.VolumeName(dest)) != 2 {
			return errors.New("provide an existing local drive folder")
		}
		info, err := os.Stat(dest)
		if err != nil || !info.IsDir() {
			return errors.New("destination must be an existing folder")
		}
		profile := "default"
		if len(args) == 3 {
			profile = args[2]
		}
		if !regexp.MustCompile("^[a-z0-9][a-z0-9_-]{0,31}$").MatchString(profile) {
			return errors.New("invalid destination profile ID")
		}
		if cfg.Profiles == nil {
			cfg.Profiles = map[string]string{}
		}
		if len(cfg.Profiles) >= 20 && cfg.Profiles[profile] == "" {
			return errors.New("at most 20 profiles are supported")
		}
		cfg.Profiles[profile] = dest
		if profile == "default" {
			cfg.Destination = dest
		}
		return save(path, cfg)
	case "tools":
		if len(args) != 3 {
			return errors.New("usage: tools <absolute yt-dlp.exe path> <absolute ffmpeg.exe path>")
		}
		for _, tool := range args[1:] {
			info, err := os.Stat(tool)
			if !filepath.IsAbs(tool) || err != nil || !info.Mode().IsRegular() {
				return errors.New("tool paths must identify installed local executables")
			}
		}
		cfg.Tools = tools.Config{YTDLP: args[1], FFmpeg: args[2]}
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
		if cfg.ID == "" || cfg.Destination == "" && len(cfg.Profiles) == 0 {
			return errors.New("configure a destination and pair this agent first")
		}
		token, err := config.Unprotect(cfg.ProtectedToken)
		if err != nil {
			return err
		}
		if cfg.Profiles == nil {
			cfg.Profiles = map[string]string{}
		}
		if cfg.Profiles["default"] == "" && cfg.Destination != "" {
			cfg.Profiles["default"] = cfg.Destination
		}
		roots := make(map[string]*os.Root)
		for name, destination := range cfg.Profiles {
			root, err := os.OpenRoot(destination)
			if err != nil {
				return errors.New("could not open a configured destination")
			}
			defer root.Close()
			roots[name] = root
		}
		poll(ctx, api.Client{Origin: cfg.Origin, Token: string(token)}, roots, cfg.Tools)
		return nil
	default:
		return errors.New("unknown command")
	}
}

func poll(ctx context.Context, hub api.Client, roots map[string]*os.Root, toolsConfig tools.Config) {
	var workers sync.WaitGroup
	defer workers.Wait()
	slots := make(chan struct{}, 2)
	profiles := make([]string, 0, len(roots))
	for name := range roots {
		profiles = append(profiles, name)
	}
	media := downloader.Client()
	defer media.CloseIdleConnections()
	fmt.Println("Agent running. Press Ctrl+C to stop.")
	for ctx.Err() == nil {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return
		}
		var lease *api.Lease
		err := hub.Post(ctx, "/agent/jobs/lease", map[string]any{"profiles": profiles}, &lease)
		if err == nil && lease != nil && downloader.ValidID(lease.ID) && downloader.ValidID(lease.LeaseID) {
			if root := roots[lease.DestinationProfileID]; root != nil {
				workers.Add(1)
				go func() {
					defer workers.Done()
					defer func() { <-slots }()
					handle(ctx, hub, media, root, *lease, toolsConfig)
				}()
				continue
			}
			_ = hub.Post(ctx, "/agent/jobs/"+lease.ID+"/fail", api.Report{LeaseID: lease.LeaseID, ErrorCode: "DESTINATION_ERROR"}, nil)
		}
		<-slots
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second):
		}
	}
}

func handle(ctx context.Context, hub api.Client, media *http.Client, root *os.Root, lease api.Lease, toolsConfig tools.Config) {
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
	var result downloader.Result
	var formats []api.Format
	var err error
	if lease.Delivery != "" && lease.Delivery != "direct" {
		result, formats, err = toolsConfig.Run(jobCtx, media, root, lease, &progress)
	} else {
		result, err = downloader.Download(jobCtx, media, root, lease.ID, lease.LeaseID, lease.URL, lease.MediaType, &progress)
	}
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
	if lease.Purpose == "probe" {
		completed := report()
		completed.Formats = formats
		_ = hub.Post(jobCtx, path+"/complete", completed, nil)
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
