package openwa

import (
	"context"
	"testing"
)

// A failed call must not also return a zero-valued record: Success=false or an empty preview reads
// as if the server had answered it.
func TestCallsReturnNilResultOnError(t *testing.T) {
	c := newTestClient(t, &recordTransport{status: 409, body: `{"statusCode":409,"message":"busy","error":"Conflict"}`})
	ctx := context.Background()

	if res, err := c.Chats.SubscribePresence(ctx, "s1", SubscribePresenceRequest{}); err == nil || res != nil {
		t.Errorf("Chats.SubscribePresence = %+v, %v; want nil and an error", res, err)
	}
	if res, err := c.Groups.JoinInfo(ctx, "s1", "code"); err == nil || res != nil {
		t.Errorf("Groups.JoinInfo = %+v, %v; want nil and an error", res, err)
	}
	if res, err := c.Labels.Upsert(ctx, "s1", "l1", UpsertLabelRequest{}); err == nil || res != nil {
		t.Errorf("Labels.Upsert = %+v, %v; want nil and an error", res, err)
	}
	if res, err := c.Labels.Delete(ctx, "s1", "l1"); err == nil || res != nil {
		t.Errorf("Labels.Delete = %+v, %v; want nil and an error", res, err)
	}
}
