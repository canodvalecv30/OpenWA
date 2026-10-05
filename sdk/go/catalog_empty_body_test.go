package openwa

import (
	"context"
	"testing"
)

// The gateway answers 200 with an empty body when the account has no catalog or no product has the
// id. Decoding that into a value struct would hand back a record with every field empty, which
// cannot be told apart from a real one, so both reads must come back nil.
func TestCatalogEmptyBodyReturnsNil(t *testing.T) {
	c := newTestClient(t, &recordTransport{status: 200, body: ""})
	ctx := context.Background()

	info, err := c.Catalog.Info(ctx, "s1")
	if err != nil || info != nil {
		t.Errorf("Info = %+v, %v; want nil, nil", info, err)
	}
	product, err := c.Catalog.Product(ctx, "s1", "missing")
	if err != nil || product != nil {
		t.Errorf("Product = %+v, %v; want nil, nil", product, err)
	}
}

func TestCatalogProductDecodesBody(t *testing.T) {
	c := newTestClient(t, &recordTransport{status: 200, body: `{"id":"p1","name":"A","url":"u","isAvailable":true}`})
	product, err := c.Catalog.Product(context.Background(), "s1", "p1")
	if err != nil || product == nil || product.ID != "p1" {
		t.Errorf("Product = %+v, %v; want p1", product, err)
	}
}
