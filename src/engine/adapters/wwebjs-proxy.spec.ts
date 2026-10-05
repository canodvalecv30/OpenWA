import { buildProxyLaunchConfig } from './wwebjs-proxy';

describe('buildProxyLaunchConfig credential decoding', () => {
  // A lone `%` used to surface as a bare `URI malformed` that named nothing about the proxy.
  it.each(['http://u:p%zz@proxy:8080', 'socks5://us%er:pass@proxy:1080'])('names the proxy for %s', url => {
    expect(() => buildProxyLaunchConfig(url)).toThrow(
      'The session proxy URL has malformed percent-encoded credentials',
    );
  });

  it('accepts a correctly escaped literal %', () => {
    expect(buildProxyLaunchConfig('http://u:p%25zz@proxy:8080').proxyAuthentication).toEqual({
      username: 'u',
      password: 'p%zz',
    });
  });
});
