package config

import (
	"errors"
	"syscall"
	"unsafe"
)

var diskFree = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")

func CheckSpace(path string, required uint64) error {
	directory, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return errors.New("invalid destination")
	}
	var available uint64
	ok, _, _ := diskFree.Call(uintptr(unsafe.Pointer(directory)), uintptr(unsafe.Pointer(&available)), 0, 0)
	if ok == 0 || available < required+(32<<20) {
		return errors.New("insufficient destination space")
	}
	return nil
}
