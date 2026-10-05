/**
 * Unit-test stub for `archiver` (ESM-only). ts-jest runs in CommonJS mode, so any source file that
 * imports it — directly (StorageService) or transitively (anything that injects StorageService or a
 * module built on it, e.g. StatusStoreService) — fails to parse without this stub once pulled into the
 * unit test graph. None of the unit suites exercise the tar/zip export path itself, so stubs for
 * TarArchive and default export are sufficient. Jest applies this stub in the e2e lane too (test/ is
 * that config's rootDir); storage-export-streaming.e2e-spec.ts calls jest.unmock('archiver') to
 * exercise the real tar/zip export path.
 */

interface TarArchiveStub {
  on: (event: string, listener: (...args: unknown[]) => void) => TarArchiveStub;
  pipe: (destination: unknown) => TarArchiveStub;
  append: (source: unknown, metadata?: unknown) => TarArchiveStub;
  finalize: () => Promise<void>;
}

function makeTarArchiveStub(): TarArchiveStub {
  const stub: TarArchiveStub = {
    on: jest.fn(() => stub),
    pipe: jest.fn(() => stub),
    append: jest.fn(() => stub),
    finalize: jest.fn(() => Promise.resolve()),
  };
  return stub;
}

export const TarArchive = jest.fn(makeTarArchiveStub);

export default jest.fn();
