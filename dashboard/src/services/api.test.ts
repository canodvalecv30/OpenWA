// The API client's handling of a response that proves the stored key unusable. A 401, or a 403 because
// the key's allowedIps refuse this client, must sign the dashboard out; a role 403 must not, or every
// page an operator cannot open would log them out.
import '../test-helpers/register-hooks.ts';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let sessionApi: (typeof import('./api.ts'))['sessionApi'];
const navigations: string[] = [];

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  // jsdom's location.assign cannot be spied on (it is unforgeable) and does not navigate anyway.
  Object.defineProperty(globalThis, 'window', {
    value: { location: { assign: (url: string) => navigations.push(url) } },
    configurable: true,
    writable: true,
  });
  ({ sessionApi } = await import('./api.ts'));
});

beforeEach(() => {
  navigations.length = 0;
  sessionStorage.setItem('openwa_api_key', 'stored-key');
});

function answer(status: number, message: string): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ statusCode: status, message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )) as typeof fetch;
}

const settled = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20)),
  ]);

for (const [status, message] of [
  [401, 'Invalid API key'],
  [403, 'IP address not allowed'],
  [403, 'Client IP could not be determined'],
] as const) {
  test(`a ${status} "${message}" clears the key and returns to login`, async () => {
    answer(status, message);
    const call = sessionApi.list();
    assert.equal(await settled(call), false, 'the call settled, so its caller would render the failure');
    assert.equal(sessionStorage.getItem('openwa_api_key'), null);
    assert.deepEqual(navigations, ['/']);
  });
}

test('a role 403 keeps the key and rejects with the status', async () => {
  answer(403, 'Insufficient permissions. Required: operator');
  await assert.rejects(sessionApi.list(), (err: Error & { status?: number }) => {
    assert.equal(err.status, 403);
    assert.equal(err.message, 'Insufficient permissions. Required: operator');
    return true;
  });
  assert.equal(sessionStorage.getItem('openwa_api_key'), 'stored-key');
  assert.deepEqual(navigations, []);
});

test('the contact list walks past the 1000 contacts one response carries', async () => {
  const { contactApi } = await import('./api.ts');
  const requested: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url.replace(/^.*\/api/, ''));
    const count = url.includes('offset=0') ? 1000 : 5;
    const contacts = Array.from({ length: count }, (_, i) => ({ id: `${i}@c.us`, name: null, number: `${i}` }));
    return Promise.resolve(
      new Response(JSON.stringify(contacts), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as typeof fetch;

  const contacts = await contactApi.list('s1');
  assert.equal(contacts.length, 1005);
  assert.deepEqual(requested, [
    '/sessions/s1/contacts?limit=1000&offset=0',
    '/sessions/s1/contacts?limit=1000&offset=1000',
  ]);
});

test('the contact list is not cut off at 10,000 contacts', async () => {
  const { contactApi } = await import('./api.ts');
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const offset = Number(new URL(String(input), 'http://x').searchParams.get('offset'));
    const count = offset < 11_000 ? 1000 : 5;
    const contacts = Array.from({ length: count }, (_, i) => ({ id: `${offset + i}@c.us`, name: null }));
    return Promise.resolve(
      new Response(JSON.stringify(contacts), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as typeof fetch;

  assert.equal((await contactApi.list('s1')).length, 11_005);
});

test('the contact list rejects instead of returning a partial list when a later page stays throttled', async () => {
  const { contactApi } = await import('./api.ts');
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (!String(input).includes('offset=0')) {
      return Promise.resolve(
        new Response(JSON.stringify({ statusCode: 429, message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const contacts = Array.from({ length: 1000 }, (_, i) => ({ id: `${i}@c.us`, name: null }));
    return Promise.resolve(
      new Response(JSON.stringify(contacts), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as typeof fetch;

  await assert.rejects(
    contactApi.list('s1'),
    (err: Error & { status?: number }) => err.status === 429 && err.message === 'Too Many Requests',
  );
});
