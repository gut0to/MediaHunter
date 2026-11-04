package tools

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/downloader"
)

const (
	Unavailable downloader.Failure = "TOOL_UNAVAILABLE"
	Protected   downloader.Failure = "PROTECTED_MEDIA"
	Unsupported downloader.Failure = "UNSUPPORTED_FORMAT"
)

type Config struct{ YTDLP, FFmpeg string }

var identifier = regexp.MustCompile("^[a-zA-Z0-9_.-]{1,80}$")

type format struct {
	ID        string   `json:"format_id"`
	Extension string   `json:"ext"`
	Width     *int     `json:"width"`
	Height    *int     `json:"height"`
	FPS       *float64 `json:"fps"`
	Bitrate   *float64 `json:"tbr"`
	Audio     string   `json:"acodec"`
	Video     string   `json:"vcodec"`
	Size      *int64   `json:"filesize"`
	Approx    *int64   `json:"filesize_approx"`
	DRM       any      `json:"has_drm"`
	URL       string   `json:"url"`
	Manifest  string   `json:"manifest_url"`
	Protocol  string   `json:"protocol"`
}

func executable(path string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func (config Config) Run(ctx context.Context, client *http.Client, root *os.Root, lease api.Lease, progress *atomic.Int64) (downloader.Result, []api.Format, error) {
	return config.run(ctx, client, root, lease, progress, downloader.StartGateway)
}

func (config Config) run(ctx context.Context, client *http.Client, root *os.Root, lease api.Lease, progress *atomic.Int64, gateway func(context.Context) (string, func(), error)) (downloader.Result, []api.Format, error) {
	if !executable(config.YTDLP) {
		return downloader.Result{}, nil, Unavailable
	}
	if _, err := downloader.CheckSource(lease.URL); err != nil {
		return downloader.Result{}, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	if lease.Delivery == "hls" || lease.Delivery == "dash" {
		if err := preflight(ctx, client, lease.URL, lease.Delivery); err != nil {
			return downloader.Result{}, nil, err
		}
	}
	proxy, closeGateway, err := gateway(ctx)
	if err != nil {
		return downloader.Result{}, nil, downloader.Failed
	}
	defer closeGateway()
	common := []string{"--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir", "--no-warnings",
		"--proxy", proxy, "--socket-timeout", "12", "--retries", "2", "--fragment-retries", "2",
		"--downloader", "native", "--hls-prefer-native"}
	info, available, err := inspect(ctx, client, config.YTDLP, common, lease.URL)
	if err != nil {
		return downloader.Result{}, nil, err
	}
	if lease.Purpose == "probe" {
		return downloader.Result{}, available, nil
	}

	selector, needsMerge := "bv*+ba/b", true
	if lease.RequestedFormat != nil {
		selector = *lease.RequestedFormat
		var found bool
		for _, entry := range available {
			if entry.ID == selector && entry.HasVideo {
				found, needsMerge = true, !entry.HasAudio
				break
			}
		}
		if !found {
			return downloader.Result{}, nil, Unsupported
		}
		if needsMerge {
			selector += "+ba"
		}
	}
	if needsMerge && !executable(config.FFmpeg) {
		if lease.RequestedFormat != nil {
			return downloader.Result{}, nil, Unavailable
		}
		selector = "b"
	}
	if len(available) == 0 || info != "" && info != "video" {
		return downloader.Result{}, nil, Unsupported
	}

	// Stage tool output in a fresh private temporary directory. Copy into the
	// rooted destination using an exclusive lease-specific part file.
	directory, err := os.MkdirTemp("", "mediahunter-extract-")
	if err != nil {
		return downloader.Result{}, nil, downloader.Destination
	}
	defer os.RemoveAll(directory)
	args := append(append([]string{}, common...), "--no-progress", "--max-filesize", "10G",
		"--merge-output-format", "mkv", "-f", selector, "-o", filepath.Join(directory, "media.%(ext)s"))
	if executable(config.FFmpeg) {
		args = append(args, "--ffmpeg-location", config.FFmpeg)
	}
	command := exec.CommandContext(ctx, config.YTDLP, append(args, "--", lease.URL)...)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if err := command.Run(); err != nil {
		return downloader.Result{}, nil, Unsupported
	}
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 1 || !files[0].Type().IsRegular() {
		return downloader.Result{}, nil, Unsupported
	}
	ext := strings.ToLower(filepath.Ext(files[0].Name()))
	switch ext {
	case ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv":
	default:
		return downloader.Result{}, nil, Unsupported
	}
	input, err := os.Open(filepath.Join(directory, files[0].Name()))
	if err != nil {
		return downloader.Result{}, nil, downloader.Destination
	}
	defer input.Close()
	if executable(config.FFmpeg) {
		probe := filepath.Join(filepath.Dir(config.FFmpeg), "ffprobe.exe")
		if executable(probe) {
			check := exec.CommandContext(ctx, probe, "-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration", input.Name())
			check.Stdout, check.Stderr = io.Discard, io.Discard
			if check.Run() != nil {
				return downloader.Result{}, nil, Unsupported
			}
		}
	}
	result := downloader.Result{Part: lease.ID + "-" + lease.LeaseID + ".part", Final: lease.ID + ext}
	output, err := root.OpenFile(result.Part, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
	if err != nil {
		return downloader.Result{}, nil, downloader.Destination
	}
	hash := sha256.New()
	result.Bytes, err = io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, downloader.MaxBytes+1))
	syncErr, closeErr := output.Sync(), output.Close()
	if result.Bytes > downloader.MaxBytes || result.Bytes <= 0 || err != nil || syncErr != nil || closeErr != nil || ctx.Err() != nil {
		_ = root.Remove(result.Part)
		return downloader.Result{}, nil, downloader.Failed
	}
	result.Digest = hex.EncodeToString(hash.Sum(nil))
	progress.Store(result.Bytes)
	return result, nil, nil
}

type boundedBuffer struct{ bytes.Buffer }

func (buffer *boundedBuffer) Write(data []byte) (int, error) {
	if buffer.Len()+len(data) > 8<<20 {
		return 0, errors.New("metadata limit")
	}
	return buffer.Buffer.Write(data)
}

func positive[T int | int64 | float64](value *T) *T {
	if value == nil || *value <= 0 {
		return nil
	}
	return value
}

func inspect(ctx context.Context, client *http.Client, tool string, common []string, source string) (string, []api.Format, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	args := append(append([]string{}, common...), "--dump-single-json", "--skip-download", "--", source)
	command := exec.CommandContext(probeCtx, tool, args...)
	var output boundedBuffer
	command.Stdout, command.Stderr = &output, io.Discard
	if command.Run() != nil {
		return "", nil, Unsupported
	}
	var metadata struct {
		Type     string   `json:"_type"`
		Formats  []format `json:"formats"`
		DRM      any      `json:"has_drm"`
		URL      string   `json:"url"`
		Manifest string   `json:"manifest_url"`
		Protocol string   `json:"protocol"`
	}
	if json.Unmarshal(output.Bytes(), &metadata) != nil || metadata.Type == "playlist" || metadata.Type == "multi_video" {
		return "", nil, Unsupported
	}
	if metadata.DRM == true {
		return "", nil, Protected
	}
	result := make([]api.Format, 0, 100)
	checked := make(map[string]bool)
	protected := false
	for i := len(metadata.Formats) - 1; i >= 0 && len(result) < 100; i-- {
		entry := metadata.Formats[i]
		if entry.DRM != nil && entry.DRM != false {
			protected = true
			continue
		}
		manifest := entry.Manifest
		if manifest == "" && (strings.Contains(entry.Protocol, "m3u8") || strings.Contains(entry.Protocol, "dash")) {
			manifest = entry.URL
		}
		if manifest != "" && !checked[manifest] {
			checked[manifest] = true
			delivery := "hls"
			if strings.Contains(entry.Protocol, "dash") || strings.Contains(manifest, ".mpd") {
				delivery = "dash"
			}
			if err := preflight(ctx, client, manifest, delivery); err != nil {
				return "", nil, err
			}
		}
		if !identifier.MatchString(entry.ID) || len(entry.Extension) > 20 {
			continue
		}
		size := positive(entry.Size)
		if size == nil {
			size = positive(entry.Approx)
		}
		result = append(result, api.Format{ID: entry.ID, Format: entry.Extension, Width: positive(entry.Width), Height: positive(entry.Height),
			FPS: positive(entry.FPS), Bitrate: positive(entry.Bitrate), HasAudio: entry.Audio != "none" && entry.Audio != "",
			HasVideo: entry.Video != "none" && entry.Video != "", EstimatedBytes: size})
	}
	if len(result) == 0 {
		if protected {
			return "", nil, Protected
		}
		return "", nil, Unsupported
	}
	return metadata.Type, result, nil
}
