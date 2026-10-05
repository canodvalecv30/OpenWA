package openwa

import (
	"encoding/json"
	"strings"
	"testing"
)

// The server always sends details on /health/ready, so the field is not optional.
func TestHealthReadyResponseDetailsIsRequired(t *testing.T) {
	b, err := json.Marshal(HealthReadyResponse{Status: "ok"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"details"`) {
		t.Errorf("marshalled %s, want a details key", b)
	}
}
