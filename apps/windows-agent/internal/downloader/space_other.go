//go:build !windows

package downloader

import "os"

// The executable targets Windows. Non-Windows builds support fixture tests.
func checkSpace(_ *os.Root, _ int64) error { return nil }
