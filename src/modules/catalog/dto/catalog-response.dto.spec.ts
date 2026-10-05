import { ProductDto } from './catalog-response.dto';

describe('ProductDto', () => {
  // The Baileys adapter renders priceFormatted with Intl.NumberFormat('en', { style: 'currency' }), so
  // the documented example has to be a string that call can produce (Intl separates the code with a
  // no-break space, which the example writes as a plain one).
  it('documents a priceFormatted example the gateway actually emits', () => {
    const props = Reflect.getMetadata('swagger/apiModelProperties', ProductDto.prototype, 'priceFormatted') as {
      example?: string;
    };
    const rendered = new Intl.NumberFormat('en', { style: 'currency', currency: 'IDR' })
      .format(85000)
      .replace(/\u00a0/g, ' ');
    expect(props.example).toBe(rendered);
  });
});
