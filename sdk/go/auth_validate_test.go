package openwa

import (
	"encoding/json"
	"testing"
)

// The validate route reports whether the key is restricted to selected sessions.
func TestAuthValidateResponseDecodesScoped(t *testing.T) {
	var out AuthValidateResponse
	if err := json.Unmarshal([]byte(`{"valid":true,"role":"viewer","scoped":true}`), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Scoped {
		t.Errorf("Scoped = false, want true")
	}
}
