package config

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Logger struct {
	directory string
	mutex     sync.Mutex
}

func NewLogger(directory string) *Logger { return &Logger{directory: directory} }

func (logger *Logger) Event(event, code string) {
	logger.mutex.Lock()
	defer logger.mutex.Unlock()
	if os.MkdirAll(logger.directory, 0700) != nil {
		return
	}
	path := filepath.Join(logger.directory, "agent.log")
	if info, err := os.Stat(path); err == nil && info.Size() >= 5<<20 {
		_ = os.Remove(path + ".3")
		_ = os.Rename(path+".2", path+".3")
		_ = os.Rename(path+".1", path+".2")
		_ = os.Rename(path, path+".1")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer file.Close()
	data := map[string]string{"time": time.Now().UTC().Format(time.RFC3339), "event": event}
	if code != "" {
		data["code"] = code
	}
	_ = json.NewEncoder(io.MultiWriter(file, os.Stdout)).Encode(data)
}
