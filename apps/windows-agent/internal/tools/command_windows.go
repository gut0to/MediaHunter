package tools

import (
	"context"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

func commandContext(ctx context.Context, executable string, arguments ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, executable, arguments...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	command.WaitDelay = 3 * time.Second
	command.Cancel = func() error {
		if command.Process == nil {
			return nil
		}
		stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		stop := exec.CommandContext(stopCtx, "taskkill.exe", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F")
		stop.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if stop.Run() != nil {
			return command.Process.Kill()
		}
		return nil
	}
	return command
}
