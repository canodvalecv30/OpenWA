// Recovery for a failed dynamic import() of a route/lazy chunk. The dominant cause is a redeploy:
// the running index.html references hashed chunk filenames that no longer exist on the server, so
// import() rejects. A one-time full reload pulls the fresh index + chunks. A sessionStorage timestamp
// guards against a reload loop when the failure is not deploy-related (adblock, offline, real 404):
// a failure within RELOAD_WINDOW_MS of the last reload is surfaced instead of reloading again.
// React-free on purpose so it is unit-testable without a DOM. See lazyWithRetry.ts for the wiring.

const RELOAD_KEY = 'owa_chunk_reloaded';

// Long enough to cover a slow reload reaching the same failing chunk again, short enough that a later
// redeploy in the same tab still gets its reload. The guard is not cleared on success: a nested lazy
// chunk that keeps failing after its route chunk loaded would otherwise reload on every page load.
const RELOAD_WINDOW_MS = 30_000;

export interface ChunkReloadDeps {
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}

export async function loadChunkWithReload<T>(factory: () => Promise<T>, deps: ChunkReloadDeps): Promise<T> {
  try {
    return await factory();
  } catch (err) {
    // A missing key reads as 0 and a legacy '1' flag as long ago, so both allow the first reload.
    const lastReload = Number(deps.storage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - lastReload >= RELOAD_WINDOW_MS) {
      deps.storage.setItem(RELOAD_KEY, String(Date.now()));
      deps.reload();
      // Hold Suspense until the reload navigates away; never resolve/reject this load.
      return new Promise<T>(() => {});
    }
    // A reload just happened and it still failed → let the caller's error boundary surface it.
    throw err;
  }
}
