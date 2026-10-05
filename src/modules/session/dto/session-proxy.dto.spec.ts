import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateSessionProxyDto, projectSessionProxy } from './session-proxy.dto';

describe('UpdateSessionProxyDto proxyUrl validation', () => {
  const errs = (body: Record<string, unknown>): ReturnType<typeof validateSync> =>
    validateSync(plainToInstance(UpdateSessionProxyDto, body));

  it.each([
    'http://proxy.example.com:8080',
    'http://user:pass@proxy.example.com:8080',
    'https://proxy.example.com:8443',
    'socks5://proxy.example.com:1080',
    'socks4://proxy.example.com:1080',
    'http://localhost:8080',
    'http://squid:3128',
    'socks5://proxy:1080',
    'http://10.0.0.1:8080',
  ])('accepts a valid proxy URL: %s', url => {
    expect(errs({ proxyUrl: url })).toHaveLength(0);
  });

  it.each(['not a url', 'proxy.example.com:8080', 'ftp://proxy.example.com:21', 'javascript:alert(1)'])(
    'rejects an invalid / non-proxy-scheme proxyUrl: %s',
    url => {
      expect(errs({ proxyUrl: url }).length).toBeGreaterThan(0);
    },
  );

  it('allows null proxyUrl (clear proxy)', () => {
    expect(errs({ proxyUrl: null })).toHaveLength(0);
  });

  it('allows an empty body', () => {
    expect(errs({})).toHaveLength(0);
  });
});

describe('projectSessionProxy', () => {
  it('reports disabled when no proxy is stored', () => {
    expect(projectSessionProxy({ proxyUrl: null })).toEqual({
      enabled: false,
      proxyType: null,
      proxyHost: null,
      hasCredentials: false,
    });
  });

  it('returns host:port without credentials', () => {
    expect(
      projectSessionProxy({
        proxyUrl: 'http://user:secret@proxy.internal:8080',
      }),
    ).toEqual({
      enabled: true,
      proxyType: 'http',
      proxyHost: 'proxy.internal:8080',
      hasCredentials: true,
    });
  });

  it('derives proxyType from the URL scheme, not the stored column', () => {
    expect(
      projectSessionProxy({
        proxyUrl: 'socks5://proxy.example.com:1080',
      }),
    ).toEqual({
      enabled: true,
      proxyType: 'socks5',
      proxyHost: 'proxy.example.com:1080',
      hasCredentials: false,
    });
  });

  it('never includes the full proxyUrl in the projection', () => {
    const result = projectSessionProxy({
      proxyUrl: 'socks5://proxy.example.com:1080',
    });
    expect(result).not.toHaveProperty('proxyUrl');
    expect(result.proxyHost).toBe('proxy.example.com:1080');
    expect(result.hasCredentials).toBe(false);
  });
});

describe('UpdateSessionProxyDto OpenAPI schema', () => {
  it('publishes the 255-character proxyUrl limit the validator enforces', () => {
    const meta = Reflect.getMetadata('swagger/apiModelProperties', UpdateSessionProxyDto.prototype, 'proxyUrl') as {
      maxLength?: number;
    };
    expect(meta.maxLength).toBe(255);
  });
});
