import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunkWithReload } from './chunkReload.ts';

function makeStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('returns the module on success without reloading', async () => {
  const storage = makeStorage();
  const mod = { default: 'Component' };
  let reloads = 0;

  const result = await loadChunkWithReload(() => Promise.resolve(mod), { reload: () => reloads++, storage });

  assert.equal(result, mod);
  assert.equal(reloads, 0);
});

test('reloads exactly once on a chunk failure when no reload has happened yet', async () => {
  const storage = makeStorage();
  let reloads = 0;

  // The result never settles (Suspense holds until the reload), so don't await it.
  void loadChunkWithReload(() => Promise.reject(new Error('Loading chunk 7 failed')), {
    reload: () => reloads++,
    storage,
  });
  await flush();

  assert.equal(reloads, 1);
  assert.ok(Date.now() - Number(storage.getItem('owa_chunk_reloaded')) < 1000);
});

test('rethrows instead of reloading again when a reload just happened (no loop)', async () => {
  const storage = makeStorage({ owa_chunk_reloaded: String(Date.now()) });
  let reloads = 0;

  await assert.rejects(
    loadChunkWithReload(() => Promise.reject(new Error('still failing')), { reload: () => reloads++, storage }),
    /still failing/,
  );
  assert.equal(reloads, 0);
});

// A page load where the route chunk loads and a nested lazy chunk (DashboardCharts) keeps failing.
// The route chunk's success must not re-arm the guard, or every load reloads the page again.
test('a successful chunk in the same load does not re-arm the reload for a failing one', async () => {
  const storage = makeStorage();
  let reloads = 0;
  const deps = { reload: () => reloads++, storage };
  const failing = () => Promise.reject(new Error('blocked'));

  void loadChunkWithReload(failing, deps);
  await flush();
  assert.equal(reloads, 1);

  // The next page load after that reload.
  await loadChunkWithReload(() => Promise.resolve({ default: 'Dashboard' }), deps);
  await assert.rejects(loadChunkWithReload(failing, deps), /blocked/);
  assert.equal(reloads, 1);
});

test('reloads again for a failure well after the last reload (a later redeploy)', async () => {
  const storage = makeStorage({ owa_chunk_reloaded: String(Date.now() - 60 * 60 * 1000) });
  let reloads = 0;

  void loadChunkWithReload(() => Promise.reject(new Error('Loading chunk 9 failed')), {
    reload: () => reloads++,
    storage,
  });
  await flush();

  assert.equal(reloads, 1);
});

test('a flag left by an older build still allows the first reload', async () => {
  const storage = makeStorage({ owa_chunk_reloaded: '1' });
  let reloads = 0;

  void loadChunkWithReload(() => Promise.reject(new Error('Loading chunk 3 failed')), {
    reload: () => reloads++,
    storage,
  });
  await flush();

  assert.equal(reloads, 1);
});
