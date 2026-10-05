import 'reflect-metadata';
import { validate } from 'class-validator';
import { InstallFromUrlDto } from './plugin.dto';

/**
 * The install/update-from-URL boundary: the DTO checks only the coarse shape — an absolute http(s)
 * URL. The transport policy itself (plain http is accepted only when the URL carries a `#sha256=`
 * content pin, verified against the download) is enforced once, at the download funnel every install
 * path shares — see plugin-download.spec.ts and plugins.service.spec.ts.
 */
describe('InstallFromUrlDto', () => {
  const dtoWith = (url: string): InstallFromUrlDto => {
    const dto = new InstallFromUrlDto();
    dto.url = url;
    return dto;
  };

  it('accepts an https:// URL', async () => {
    await expect(validate(dtoWith('https://plugins.example/pkg.zip'))).resolves.toHaveLength(0);
  });

  it('accepts an https:// URL carrying a #sha256 integrity fragment', async () => {
    const digest = 'a'.repeat(64);
    await expect(validate(dtoWith(`https://plugins.example/pkg.zip#sha256=${digest}`))).resolves.toHaveLength(0);
  });

  it('accepts a plain http:// URL at the DTO — the pin requirement is enforced at the download funnel', async () => {
    await expect(validate(dtoWith('http://plugins.example/pkg.zip'))).resolves.toHaveLength(0);
    const digest = 'a'.repeat(64);
    await expect(validate(dtoWith(`http://plugins.example/pkg.zip#sha256=${digest}`))).resolves.toHaveLength(0);
  });

  it('accepts single-label and underscore hosts, which the download guard allow-lists by name', async () => {
    const digest = 'a'.repeat(64);
    await expect(validate(dtoWith(`http://plugin-mirror:8080/x.zip#sha256=${digest}`))).resolves.toHaveLength(0);
    await expect(validate(dtoWith(`http://localhost:8080/p.zip#sha256=${digest}`))).resolves.toHaveLength(0);
    await expect(validate(dtoWith('https://h_x.example.com/p.zip'))).resolves.toHaveLength(0);
  });

  it('rejects a non-http(s) scheme', async () => {
    const errors = await validate(dtoWith('ftp://plugins.example/pkg.zip'));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('url');
  });

  it('rejects a non-URL value', async () => {
    const errors = await validate(dtoWith('not-a-url'));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('url');
  });
});
