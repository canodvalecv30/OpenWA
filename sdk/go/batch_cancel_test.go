package openwa

import (
	"context"
	"testing"
)

// The cancel route answers the batch state without per-recipient results, so CancelBatch returns
// its own type rather than a BatchStatusResponse whose Results would always read empty.
func TestCancelBatchDecodesCancelResponse(t *testing.T) {
	rt := &recordTransport{
		status: 200,
		body:   `{"batchId":"b1","status":"cancelled","progress":{"total":2,"sent":1,"failed":0,"pending":0,"cancelled":1}}`,
	}
	c := newTestClient(t, rt)
	var res *BatchCancelResponse
	res, err := c.Messages.CancelBatch(context.Background(), "s1", "b1")
	if err != nil {
		t.Fatal(err)
	}
	if res.BatchID != "b1" || res.Status != "cancelled" || res.Progress.Cancelled != 1 {
		t.Errorf("CancelBatch = %+v", res)
	}
}
