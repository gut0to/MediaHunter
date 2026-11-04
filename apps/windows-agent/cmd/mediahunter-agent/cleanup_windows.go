package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var partialName = regexp.MustCompile("^[0-9a-f-]{36}-[0-9a-f-]{36}\\.part$")

func cleanupToolDirectories(directory string) {
	base, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "mediahunter-extract-") {
			continue
		}
		candidate := filepath.Join(base, entry.Name())
		real, err := filepath.EvalSymlinks(candidate)
		if err != nil || filepath.Dir(real) != base {
			continue
		}
		info, err := os.Lstat(candidate)
		if err == nil && info.Mode().IsDir() && info.ModTime().Before(time.Now().Add(-24*time.Hour)) {
			_ = os.RemoveAll(candidate)
		}
	}
}

func cleanupPartials(root *os.Root) {
	directory, err := root.Open(".")
	if err != nil {
		return
	}
	defer directory.Close()
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		if !partialName.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() && info.ModTime().Before(cutoff) {
			_ = root.Remove(entry.Name())
		}
	}
}
