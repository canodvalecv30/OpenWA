import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as fs from 'fs';
import { writeSecretFile } from './secret-file';

// A named import of chmodSync cannot be spied on after the fact, so route it through a mock that
// defaults to the real call.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, chmodSync: jest.fn(actual.chmodSync) };
});

describe('writeSecretFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owa-secret-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mode = (p: string): number => statSync(p).mode & 0o777;
  const expectOwnerOnly = (p: string): void => {
    expect(existsSync(p)).toBe(true);
    if (process.platform !== 'win32') {
      expect(mode(p) & 0o077).toBe(0);
    }
  };

  it('writes a new secret file owner-only (no group/other access)', () => {
    const p = join(dir, 'secret');
    writeSecretFile(p, 'topsecret');
    expectOwnerOnly(p);
    expect(readFileSync(p, 'utf8')).toBe('topsecret');
  });

  it('tightens an already-existing world-readable file (writeFileSync mode only applies on create)', () => {
    const p = join(dir, 'legacy');
    writeFileSync(p, 'old', { mode: 0o644 });
    if (process.platform !== 'win32') {
      expect(mode(p) & 0o077).not.toBe(0); // precondition: loose
    }

    writeSecretFile(p, 'new');
    expectOwnerOnly(p);
    expect(readFileSync(p, 'utf8')).toBe('new');
  });

  it('does not warn when the file simply does not exist yet (create-mode covers it)', () => {
    const p = join(dir, 'fresh');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    writeSecretFile(p, 'secret');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(readFileSync(p, 'utf8')).toBe('secret');
    warnSpy.mockRestore();
  });

  it('warns to the console when a chmod fails for any other reason (does not stay silently world-readable)', () => {
    const p = join(dir, 'nochmod');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(fs.chmodSync).mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });

    // The write still succeeds (create-mode), and both failures are surfaced instead of swallowed.
    writeSecretFile(p, 'secret');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pre-write chmod 0o600 failed'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('post-write chmod 0o600 failed'));
    expect(readFileSync(p, 'utf8')).toBe('secret');

    jest.mocked(fs.chmodSync).mockImplementation(jest.requireActual<typeof import('fs')>('fs').chmodSync);
    warnSpy.mockRestore();
  });
});
