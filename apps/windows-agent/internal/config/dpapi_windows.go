package config

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

type blob struct {
	size uint32
	data *byte
}

var crypt32 = syscall.NewLazyDLL("crypt32.dll")
var protect = crypt32.NewProc("CryptProtectData")
var unprotect = crypt32.NewProc("CryptUnprotectData")
var localFree = syscall.NewLazyDLL("kernel32.dll").NewProc("LocalFree")

func transform(proc *syscall.LazyProc, data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty credential")
	}
	input := blob{uint32(len(data)), &data[0]}
	var output blob
	success, _, _ := proc.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&output)))
	runtime.KeepAlive(data)
	if success == 0 {
		return nil, errors.New("Windows could not access the protected credential")
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.data)))
	return append([]byte(nil), unsafe.Slice(output.data, output.size)...), nil
}

func Protect(data []byte) ([]byte, error)   { return transform(protect, data) }
func Unprotect(data []byte) ([]byte, error) { return transform(unprotect, data) }
