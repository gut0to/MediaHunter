//go:build !windows

package tools

import (
	"context"
	"os/exec"
	"time"
)

func commandContext(ctx context.Context, executable string, arguments ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, executable, arguments...)
	command.WaitDelay = 3 * time.Second
	return command
}
