package openwa

import (
	"context"
	"testing"
)

// A failed call must not also return a zero-valued record: a caller that checks the result reads
// an empty channel or Success=false as if the server had answered it.
func TestChannelsWritesReturnNilResultOnError(t *testing.T) {
	c := newTestClient(t, &recordTransport{status: 409, body: `{"statusCode":409,"message":"busy","error":"Conflict"}`})
	ctx := context.Background()

	if res, err := c.Channels.Create(ctx, "s1", CreateChannelRequest{}); err == nil || res != nil {
		t.Errorf("Create = %+v, %v; want nil and an error", res, err)
	}
	if res, err := c.Channels.Delete(ctx, "s1", "c1"); err == nil || res != nil {
		t.Errorf("Delete = %+v, %v; want nil and an error", res, err)
	}
	if res, err := c.Channels.Mute(ctx, "s1", "c1", MuteChannelRequest{}); err == nil || res != nil {
		t.Errorf("Mute = %+v, %v; want nil and an error", res, err)
	}
}
