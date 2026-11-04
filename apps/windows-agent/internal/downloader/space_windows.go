package downloader

import (
	"os"

	"mediahunter/agent/internal/config"
)

func checkSpace(root *os.Root, length int64) error {
	if length < 64<<20 {
		length = 64 << 20
	}
	if config.CheckSpace(root.Name(), uint64(length)) != nil {
		return Destination
	}
	return nil
}
