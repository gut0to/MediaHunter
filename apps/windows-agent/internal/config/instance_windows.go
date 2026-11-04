package config

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"syscall"
	"unsafe"
)

var createMutex = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW")

func LockInstance(directory string) (func(), error) {
	hash := sha256.Sum256([]byte(directory))
	name, _ := syscall.UTF16PtrFromString("Local\\MediaHunterAgent-" + hex.EncodeToString(hash[:8]))
	handle, _, last := createMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return nil, errors.New("could not acquire the agent instance lock")
	}
	if last == syscall.ERROR_ALREADY_EXISTS {
		_ = syscall.CloseHandle(syscall.Handle(handle))
		return nil, errors.New("an agent instance is already running for this user")
	}
	return func() { _ = syscall.CloseHandle(syscall.Handle(handle)) }, nil
}
