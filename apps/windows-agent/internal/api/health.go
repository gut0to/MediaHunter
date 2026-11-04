package api

import (
	"context"
	"net/http"
)

func Health(ctx context.Context, origin string) string {
	if !ValidOrigin(origin) {
		return "invalid configuration"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/api/v1/health", nil)
	if err != nil {
		return "unavailable"
	}
	response, err := client.Do(request)
	if err != nil {
		return "unavailable"
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "unavailable"
	}
	return "online"
}
