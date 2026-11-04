package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"syscall"
	"time"

	"mediahunter/agent/internal/api"
	"mediahunter/agent/internal/downloader"
)

type receipt struct {
	Profile  string
	Filename string
	Size     int64
}

var receiptFile = regexp.MustCompile("^[0-9a-f-]{36}\\.(jpg|png|gif|webp|avif|bmp|ico|mp4|webm|mkv|mov|m4v|ogv)$")

func saveReceipt(directory string, lease api.Lease, result downloader.Result) error {
	if !downloader.ValidID(lease.ID) || !receiptFile.MatchString(result.Final) {
		return errors.New("invalid receipt")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(receipt{Profile: lease.DestinationProfileID, Filename: result.Final, Size: result.Bytes})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(directory, lease.ID+".json"), data, 0600)
}

func openReceipt(ctx context.Context, directory, jobID, action string, roots map[string]*os.Root) error {
	if !downloader.ValidID(jobID) || (action != "file" && action != "folder") {
		return errors.New("invalid local action")
	}
	data, err := os.ReadFile(filepath.Join(directory, jobID+".json"))
	if err != nil || len(data) > 4096 {
		return errors.New("download receipt unavailable")
	}
	var record receipt
	if json.Unmarshal(data, &record) != nil || !receiptFile.MatchString(record.Filename) || record.Filename[:36] != jobID {
		return errors.New("invalid download receipt")
	}
	root := roots[record.Profile]
	if root == nil {
		return errors.New("destination is unavailable")
	}
	info, err := root.Lstat(record.Filename)
	if err != nil || !info.Mode().IsRegular() || info.Size() != record.Size {
		return errors.New("saved file no longer matches the download")
	}
	path := filepath.Join(root.Name(), record.Filename)
	var command *exec.Cmd
	if action == "folder" {
		command = exec.CommandContext(ctx, "explorer.exe", "/select,", path)
	} else {
		command = exec.CommandContext(ctx, "explorer.exe", path)
	}
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Run()
}

func pollActions(ctx context.Context, hub api.Client, roots map[string]*os.Root, directory string) {
	for ctx.Err() == nil {
		var action *struct{ ID, JobID, Action string }
		if hub.Post(ctx, "/agent/actions/lease", struct{}{}, &action) == nil && action != nil {
			actionCtx, stop := context.WithTimeout(ctx, 10*time.Second)
			_ = openReceipt(actionCtx, directory, action.JobID, action.Action, roots)
			stop()
		}
		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Second):
		}
	}
}
