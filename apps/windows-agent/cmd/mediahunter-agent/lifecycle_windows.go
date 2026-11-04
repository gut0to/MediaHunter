package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/downloader"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
	"time"
)

func lifecycle(ctx context.Context, args []string, directory, path string, cfg *settings) (bool, error) {
	switch args[0] {
	case "install":
		if len(args) > 2 || len(args) == 2 && args[1] != "--autostart" {
			return true, errors.New("usage: install [--autostart]")
		}
		return true, installAgent(ctx, directory, len(args) == 2)
	case "uninstall":
		if len(args) > 2 || len(args) == 2 && args[1] != "--credentials" {
			return true, errors.New("usage: uninstall [--credentials]")
		}
		return true, uninstallAgent(ctx, directory, len(args) == 2)
	case "limits":
		if len(args) != 2 {
			return true, errors.New("usage: limits <maximum bytes per file>")
		}
		limit, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil || limit < 1<<20 || limit > downloader.MaxBytes {
			return true, errors.New("file limit must be between 1 MiB and 10 GiB")
		}
		cfg.MaxBytes = limit
		return true, save(path, *cfg)
	case "diagnose":
		fmt.Println("Agent build targets Windows amd64.")
		fmt.Println("Paired:", cfg.ID != "")
		fmt.Println("Destination profiles:", len(cfg.Profiles))
		fmt.Println("yt-dlp:", toolVersion(ctx, cfg.Tools.YTDLP, false))
		fmt.Println("FFmpeg:", toolVersion(ctx, cfg.Tools.FFmpeg, true))
		if cfg.Origin != "" && api.ValidOrigin(cfg.Origin) {
			fmt.Println("Hub:", api.Health(ctx, cfg.Origin))
		}
		return true, nil
	}
	return false, nil
}

func systemCommand(ctx context.Context, tool string, arguments ...string) error {
	command := exec.CommandContext(ctx, tool, arguments...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if command.Run() != nil {
		return errors.New("Windows could not complete the requested lifecycle operation")
	}
	return nil
}

func installAgent(ctx context.Context, directory string, autoStart bool) error {
	source, err := os.Executable()
	if err != nil {
		return errors.New("could not locate this executable")
	}
	destination := filepath.Join(directory, "bin", "mediahunter-agent.exe")
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	if !samePath(source, destination) {
		input, err := os.Open(source)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.CreateTemp(filepath.Dir(destination), "agent-*.tmp")
		if err != nil {
			return err
		}
		defer os.Remove(output.Name())
		_, err = io.Copy(output, input)
		closeErr := output.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if err := os.Rename(output.Name(), destination); err != nil {
			return errors.New("stop the installed agent before upgrading it")
		}
	}
	if autoStart {
		if err := systemCommand(ctx, "schtasks.exe", "/Create", "/SC", "ONLOGON", "/TN", "MediaHunterAgent", "/TR", "\""+destination+"\" start", "/RL", "LIMITED", "/F"); err != nil {
			return errors.New("agent installed; automatic startup could not be registered for this user")
		}
	}
	fmt.Println("Installed the agent in the current user's application data folder.")
	return nil
}

func samePath(left, right string) bool {
	a, errA := filepath.Abs(left)
	b, errB := filepath.Abs(right)
	if errA != nil || errB != nil {
		return false
	}
	infoA, errA := os.Stat(a)
	infoB, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(infoA, infoB)
}

func uninstallAgent(ctx context.Context, directory string, clearCredentials bool) error {
	// The fixed task name is owned by this installer. Absence is harmless.
	_ = systemCommand(ctx, "schtasks.exe", "/Delete", "/TN", "MediaHunterAgent", "/F")
	destination := filepath.Join(directory, "bin", "mediahunter-agent.exe")
	source, _ := os.Executable()
	if !samePath(source, destination) {
		if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
			return errors.New("stop the agent before removing its installed executable")
		}
	}
	if clearCredentials {
		if err := os.Remove(filepath.Join(directory, "settings.json")); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	fmt.Println("Automatic startup removed. Downloaded media is retained.")
	if samePath(source, destination) {
		fmt.Println("Exit, then remove the installed executable to finish removal.")
	}
	return nil
}

func toolVersion(ctx context.Context, path string, ffmpeg bool) string {
	if !filepath.IsAbs(path) {
		return "not configured"
	}
	versionCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	args := []string{"--version"}
	if ffmpeg {
		args = []string{"-version"}
	}
	command := exec.CommandContext(versionCtx, path, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil || len(output) > 64<<10 {
		return "unavailable"
	}
	// Report a hash of the installed executable independently of tool output.
	file, err := os.Open(path)
	if err != nil {
		return "unavailable"
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "unavailable"
	}
	version := "available"
	match := regexp.MustCompile("(?m)^(?:ffmpeg version )?([0-9][0-9a-zA-Z._-]{1,50})").FindSubmatch(output)
	if len(match) == 2 {
		version = "version " + string(match[1])
	}
	return version + " (SHA-256 " + hex.EncodeToString(digest.Sum(nil)) + ")"
}
