// The restart flow driven directly through renderHook, for outcomes that turn on the exact answer to
// the restart POST or on timing around an unmount. Infrastructure.test.ts covers the same hook through
// the page.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RestartStatus, useRestartFlow as useRestartFlowFn } from './useRestartFlow.ts';
import type { installJsdomGlobals as installJsdomGlobalsFn } from '../test-helpers/jsdom.ts';

type RTL = typeof import('@testing-library/react');

let rtl: RTL;
let useRestartFlow: typeof useRestartFlowFn;

// Per-test answers to the two requests the hook sends; a test that never sets one gets a hanging
// request, which is what an in-flight call looks like.
let restartAnswer: () => Promise<Response> = () => new Promise(() => {});
let readyAnswer: () => Promise<Response> = () => new Promise(() => {});
const calls: string[] = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function htmlResponse(status: number): Response {
  return new Response(`<html><body>${status}</body></html>`, { status, headers: { 'Content-Type': 'text/html' } });
}

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>(r => (resolve = r));
  return { promise, resolve };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  const { installJsdomGlobals } = (await import('../test-helpers/jsdom.ts')) as {
    installJsdomGlobals: typeof installJsdomGlobalsFn;
  };
  await installJsdomGlobals();
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/infra/restart') return restartAnswer();
    if (path === '/api/health/ready') return readyAnswer();
    return Promise.resolve(jsonResponse({ message: `unstubbed ${path}` }, 404));
  };
  rtl = await import('@testing-library/react');
  ({ useRestartFlow } = await import('./useRestartFlow.ts'));
});

afterEach(() => {
  rtl.cleanup();
  calls.length = 0;
  restartAnswer = () => new Promise(() => {});
  readyAnswer = () => new Promise(() => {});
});

async function statusAfterRestart(answer: () => Promise<Response>): Promise<RestartStatus> {
  restartAnswer = answer;
  const { result } = rtl.renderHook(() => useRestartFlow());
  rtl.act(() => void result.current.start());
  await rtl.waitFor(() => assert.notEqual(result.current.restartStatus, 'restarting'));
  return result.current.restartStatus;
}

// Cloudflare answers a slow origin with 524 and a reset or refused one with 520/522, all as an HTML
// page. The restart may still go ahead behind it, so this is the same unknown outcome as a 504.
test('a proxy 52x page on the restart request is an unknown outcome, not a refusal', async () => {
  for (const status of [520, 522, 524]) {
    assert.equal(await statusAfterRestart(() => Promise.resolve(htmlResponse(status))), 'unknown', `HTTP ${status}`);
    rtl.cleanup();
  }
});

test('a proxy 503 page and a coded gateway 5xx stay refusals', async () => {
  assert.equal(await statusAfterRestart(() => Promise.resolve(htmlResponse(503))), 'error');
  rtl.cleanup();
  const coded = jsonResponse({ message: 'Compose rejected the profile', code: 'SOME_CODE' }, 524);
  assert.equal(await statusAfterRestart(() => Promise.resolve(coded)), 'error');
});

test(
  'a restart answer that lands after unmount starts no countdown and no readiness poll',
  { timeout: 10_000 },
  async () => {
    const restart = deferred();
    restartAnswer = () => restart.promise;
    const live = new Set<unknown>();
    const { setInterval: realSet, clearInterval: realClear } = globalThis;
    globalThis.setInterval = ((fn: () => void, ms?: number) => {
      const handle = realSet(fn, ms);
      live.add(handle);
      return handle;
    }) as typeof setInterval;
    globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
      live.delete(handle);
      realClear(handle);
    }) as typeof clearInterval;
    try {
      const { result, unmount } = rtl.renderHook(() => useRestartFlow());
      rtl.act(() => void result.current.start());
      await rtl.waitFor(() => assert.ok(calls.includes('POST /api/infra/restart')));

      unmount();
      restart.resolve(jsonResponse({ message: 'restarting', restarting: true, estimatedTime: 5 }));
      // Past the first readiness poll (3s after the answer).
      await wait(3500);

      assert.ok(!calls.includes('GET /api/health/ready'), 'the readiness poll ran after unmount');
      assert.equal(live.size, 0, 'a countdown interval outlived the component');
    } finally {
      for (const handle of live) realClear(handle as ReturnType<typeof setInterval>);
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
  },
);

test('a readiness check in flight at unmount does not schedule another one', { timeout: 12_000 }, async () => {
  restartAnswer = () => Promise.resolve(jsonResponse({ message: 'restarting', restarting: true, estimatedTime: 5 }));
  const ready = deferred();
  readyAnswer = () => ready.promise;
  const { result, unmount } = rtl.renderHook(() => useRestartFlow());
  rtl.act(() => void result.current.start());
  await rtl.waitFor(() => assert.ok(calls.includes('GET /api/health/ready')), { timeout: 5_000 });

  unmount();
  ready.resolve(jsonResponse({ status: 'error', details: {} }, 503));
  readyAnswer = () => Promise.resolve(jsonResponse({ status: 'error', details: {} }, 503));
  // Past the 1s retry a failed check schedules.
  await wait(1500);

  assert.equal(calls.filter(c => c === 'GET /api/health/ready').length, 1, 'the poll re-armed after unmount');
});
