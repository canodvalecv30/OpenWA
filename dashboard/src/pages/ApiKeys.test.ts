// Render test for the API Keys page under the bare `node --test` runner, on the Templates.test.ts
// harness. The list endpoint returns only each key's prefix (the plaintext exists once, at creation),
// so the row offers no control that claims to show the key.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// The status GET /auth/api-keys answers with: 200 lists `keyList`.
let listStatus = 200;
const billingBot = {
  id: 'key-1',
  name: 'billing-bot',
  keyPrefix: 'owa_k1ab',
  role: 'operator',
  isActive: true,
  usageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};
let keyList: Record<string, unknown>[] = [billingBot];
let createBody: Record<string, unknown> | undefined;
// When set, POST /auth/api-keys answers only once this settles.
let createGate: Promise<void> | undefined;
let updateBodies: Record<string, unknown>[] = [];
let updateStatus = 200;

function installFetchStub(): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/sessions') return Promise.resolve(jsonResponse([]));
    if (init?.method === 'POST' && path === '/api/auth/api-keys') {
      createBody = JSON.parse(String(init.body));
      const created = jsonResponse({ ...billingBot, id: 'key-new', apiKey: 'owa_k1_new' }, 201);
      return createGate ? createGate.then(() => created) : Promise.resolve(created);
    }
    if (init?.method === 'PUT' && path.startsWith('/api/auth/api-keys/')) {
      updateBodies.push(JSON.parse(String(init.body)));
      if (updateStatus === 409) {
        return Promise.resolve(jsonResponse({ message: 'Cannot remove the last active admin key' }, 409));
      }
      return Promise.resolve(jsonResponse(billingBot));
    }
    if (path === '/api/auth/api-keys') {
      if (listStatus !== 200) {
        return Promise.resolve(jsonResponse({ message: 'This API key cannot access this resource' }, listStatus));
      }
      return Promise.resolve(jsonResponse(keyList));
    }
    return Promise.resolve(jsonResponse({ message: `unstubbed ${path}` }, 404));
  }) as typeof fetch;
}

let rtl: typeof import('@testing-library/react');
let ApiKeys: (typeof import('./ApiKeys.tsx'))['ApiKeys'];
let ToastProvider: (typeof import('../components/Toast.tsx'))['ToastProvider'];
let queryClient: QueryClient | undefined;

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  installFetchStub();
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ ToastProvider } = await import('../components/Toast.tsx'));
  ({ ApiKeys } = await import('./ApiKeys.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  queryClient?.clear();
  queryClient = undefined;
  listStatus = 200;
  keyList = [billingBot];
  createBody = undefined;
  createGate = undefined;
  updateBodies = [];
  updateStatus = 200;
  window.sessionStorage.removeItem('openwa_api_key');
});

function renderApiKeys(): void {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ToastProvider, null, createElement(ApiKeys)),
    ),
  );
}

test('a key row shows its prefix masked and offers no show/hide toggle', async () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ToastProvider, null, createElement(ApiKeys)),
    ),
  );
  await rtl.screen.findByText('owa_k1ab****');
  assert.ok(
    !rtl.screen.queryByRole('button', { name: 'Show API key' }),
    'the row offers to show a key it does not have',
  );
});

// ApiKeys.css turns rows into cards at max-width: 768px, which has no slot for the Last Used cell.
test('at 768px the table drops the columns the card layout has no place for', async () => {
  const width = window.innerWidth;
  window.innerWidth = 768;
  try {
    renderApiKeys();
    await rtl.screen.findByText('owa_k1ab****');
    assert.equal(rtl.screen.queryByText('Last Used') === null, true, 'the Last Used column is still shown');
  } finally {
    window.innerWidth = width;
  }
});

// An admin key restricted to sessions is refused here (the route needs an unscoped key), and a
// failed read is not an empty list: "No API keys created" would read as a gateway with no keys.
test('a refused read says so instead of showing the empty state', async () => {
  listStatus = 403;
  renderApiKeys();
  await rtl.screen.findByText('No access to API keys');
  assert.ok(!rtl.screen.queryByText('No API keys created'), 'a refused read rendered as an empty list');
});

test('a failed read shows the error instead of the empty state', async () => {
  listStatus = 500;
  renderApiKeys();
  await rtl.screen.findByText('Could not load API keys');
  assert.ok(!rtl.screen.queryByText('No API keys created'), 'a failed read rendered as an empty list');
});

async function openCreate(): Promise<HTMLButtonElement> {
  renderApiKeys();
  await rtl.screen.findByText('owa_k1ab****');
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Create API Key' }));
  return rtl.screen.getByRole<HTMLButtonElement>('button', { name: 'Create' });
}

test('a create sends the IP allow-list, chats and expiry only when filled in', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  let create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ab' } });
  assert.equal(create.disabled, true, 'the gateway needs at least 3 characters');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.click(create);
  await waitFor(() => assert.ok(createBody));
  assert.deepEqual(createBody, { name: 'crm-bot', role: 'operator', allowedSessions: [] });

  rtl.cleanup();
  createBody = undefined;
  create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.change(screen.getByLabelText('Allowed IP addresses (optional)'), {
    target: { value: ' 10.0.0.1 \n\n10.0.0.0/8\n' },
  });
  fireEvent.change(screen.getByLabelText('Chat access (optional)'), {
    target: { value: '6281234\n120363000@g.us\n6281234@c.us' },
  });
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '2027-06-01T09:30' } });
  fireEvent.click(create);
  await waitFor(() => assert.ok(createBody));
  assert.deepEqual(createBody, {
    name: 'crm-bot',
    role: 'operator',
    allowedSessions: [],
    allowedIps: ['10.0.0.1', '10.0.0.0/8'],
    allowedChats: ['6281234@c.us', '120363000@g.us'],
    expiresAt: new Date('2027-06-01T09:30').toISOString(),
  });
});

// The key exists once the request lands; a modal closed meanwhile would leave its one-time secret
// unseen and pop it up on the next Create API Key click.
test('the create modal stays open until the request settles and then shows the secret', async () => {
  const { screen, fireEvent } = rtl;
  let release = (): void => {};
  createGate = new Promise(resolve => {
    release = resolve;
  });
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.click(create);
  const cancel = await screen.findByRole<HTMLButtonElement>('button', { name: 'Cancel' });
  await rtl.waitFor(() => assert.equal(cancel.disabled, true, 'Cancel is live while the key is being created'));
  assert.equal(screen.queryByRole('button', { name: 'Close' }) === null, true, 'the close button is live mid-request');
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.mouseDown(document.querySelector('.modal-overlay') as HTMLElement);
  screen.getByRole('dialog');
  release();
  await screen.findByText('owa_k1_new');
});

// The gateway counts an emoji, with or without its presentation selector, as one character.
test('a name of two emoji keeps Create disabled', async () => {
  const { screen, fireEvent } = rtl;
  const create = await openCreate();
  for (const name of ['\u{1F511}\u{1F511}', '\u2714\uFE0F\u2714\uFE0F']) {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
    assert.equal(create.disabled, true, `Create is enabled for ${name}`);
    screen.getByText('Use at least 3 characters.');
  }
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '\u{1F511}\u{1F511}\u{1F511}' } });
  assert.equal(create.disabled, false);
});

// A production gateway refuses a name over 100 characters with a bare "Bad Request". It counts code
// points, while a maxlength attribute counts UTF-16 units and would cut an emoji name at 50.
test('a key name over the 100 characters the gateway takes keeps Create disabled', async () => {
  const { screen, fireEvent } = rtl;
  const create = await openCreate();
  const name = screen.getByLabelText<HTMLInputElement>('Name');
  assert.equal(name.hasAttribute('maxlength'), false);
  fireEvent.change(name, { target: { value: '\u{1F511}'.repeat(100) } });
  assert.equal(create.disabled, false, 'Create is disabled for a 100-character name');
  const regions = screen.queryAllByRole('status');
  fireEvent.change(name, { target: { value: '\u{1F511}'.repeat(101) } });
  assert.equal(create.disabled, true, 'Create is enabled for a 101-character name');
  // A live region mounted together with its text is often not announced, so the hint fills one already there.
  assert.ok(regions.includes(screen.getByText('Limited to 100 characters (101 now).')));
});

test('an IP or chat line the gateway would refuse keeps Create disabled and names the line', async () => {
  const { screen, fireEvent } = rtl;
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.change(screen.getByLabelText('Allowed IP addresses (optional)'), {
    target: { value: '10.0.0.1\n10.0.0.0/33' },
  });
  assert.equal(create.disabled, true);
  screen.getByText('Not an IPv4 address or CIDR range: 10.0.0.0/33');

  fireEvent.change(screen.getByLabelText('Allowed IP addresses (optional)'), { target: { value: '10.0.0.1' } });
  fireEvent.change(screen.getByLabelText('Chat access (optional)'), { target: { value: 'sales-team' } });
  assert.equal(create.disabled, true);
  screen.getByText('Not a chat ID or phone number: sales-team');
  fireEvent.click(create);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(createBody, undefined);
});

test('switching the new key to admin hides and drops the chat list', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'root-key' } });
  fireEvent.change(screen.getByLabelText('Chat access (optional)'), { target: { value: '120363000@g.us' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
  assert.equal(screen.queryByLabelText('Chat access (optional)') === null, true);
  fireEvent.click(create);
  await waitFor(() => assert.ok(createBody));
  assert.deepEqual(createBody, { name: 'root-key', role: 'admin' });
});

test('a key row shows its IP, chat and expiry limits, and an expired key is not badged active', async () => {
  keyList = [
    {
      ...billingBot,
      allowedIps: ['10.0.0.1', '10.0.0.0/8'],
      allowedChats: ['120363000@g.us'],
      expiresAt: '2020-01-01T00:00:00.000Z',
    },
    { ...billingBot, id: 'key-2', name: 'open-key', keyPrefix: 'owa_k1cd' },
  ];
  renderApiKeys();
  await rtl.screen.findByText('IPs: 2');
  rtl.screen.getByText('Chats: 1');
  rtl.screen.getByText(/^Expired .+/);
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  assert.equal(rows[0].querySelector('.status-badge')?.textContent, 'Expired');
  assert.equal(rows[1].querySelector('.status-badge')?.textContent, 'Active');
  assert.equal(rows[1].querySelector('.restrictions-cell')?.textContent, 'None');
});

test('an active admin key can be edited; a revoked key cannot', async () => {
  keyList = [
    { ...billingBot, role: 'admin' },
    { ...billingBot, id: 'key-2', name: 'old-key', keyPrefix: 'owa_k1cd', isActive: false },
  ];
  renderApiKeys();
  await rtl.screen.findByText('owa_k1ab****');
  assert.equal(rtl.screen.getAllByTitle('Edit access').length, 1);
  rtl.fireEvent.click(rtl.screen.getByTitle('Edit access'));
  // Admin keys stay unscoped in the dashboard: no session or chat fields.
  assert.equal(rtl.screen.queryByLabelText('Chat access (optional)') === null, true);
  rtl.screen.getByLabelText('Allowed IP addresses (optional)');
});

async function openEdit(key: Record<string, unknown>): Promise<HTMLButtonElement> {
  keyList = [key];
  renderApiKeys();
  await rtl.screen.findByText(`${String(key.keyPrefix)}****`);
  rtl.fireEvent.click(rtl.screen.getByTitle('Edit access'));
  return rtl.screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
}

test('saving an untouched key sends nothing, even with an expiry and lists set', async () => {
  const save = await openEdit({
    ...billingBot,
    allowedIps: ['10.0.0.1'],
    allowedChats: ['6281234@c.us'],
    allowedSessions: ['sess-gone'],
    expiresAt: '2027-03-04T05:06:59.000Z',
  });
  rtl.fireEvent.click(save);
  await rtl.waitFor(() => assert.equal(rtl.screen.queryByRole('button', { name: 'Save' }) === null, true));
  assert.deepEqual(updateBodies, []);
});

test('an edit sends only what changed', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  let save = await openEdit({ ...billingBot, expiresAt: '2027-03-04T05:06:59.000Z' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.change(screen.getByLabelText('Chat access (optional)'), { target: { value: '6281234' } });
  fireEvent.click(save);
  await waitFor(() => assert.equal(updateBodies.length, 1));
  assert.deepEqual(updateBodies[0], { allowedChats: ['6281234@c.us'], expiresAt: null });

  rtl.cleanup();
  save = await openEdit({ ...billingBot, allowedSessions: ['sess-1'] });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
  fireEvent.click(save);
  await waitFor(() => assert.equal(updateBodies.length, 2));
  assert.deepEqual(updateBodies[1], { role: 'admin', allowedSessions: [] });
});

test('a bad IP line keeps Save disabled in the editor', async () => {
  const { screen, fireEvent } = rtl;
  const save = await openEdit(billingBot);
  fireEvent.change(screen.getByLabelText('Allowed IP addresses (optional)'), { target: { value: '::1' } });
  assert.equal(save.disabled, true);
  screen.getByText('Not an IPv4 address or CIDR range: ::1');
  fireEvent.click(save);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(updateBodies, []);
});

// A list stored before the gateway checked entries, or before a chat rule tightened, is not sent when
// left as it is, so its old entries must not block an unrelated edit.
test('an untouched list with an entry the form would refuse does not block Save', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  const save = await openEdit({
    ...billingBot,
    allowedIps: ['fd00::1', '10.0.0.1'],
    allowedChats: ['legacy-chat'],
    expiresAt: '2027-03-04T05:06:59.000Z',
  });
  assert.equal(save.disabled, false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.click(save);
  await waitFor(() => assert.equal(updateBodies.length, 1));
  assert.deepEqual(updateBodies[0], { expiresAt: null });

  // Once the list is edited it is sent whole, so every entry is checked again.
  rtl.cleanup();
  const edited = await openEdit({ ...billingBot, allowedIps: ['fd00::1', '10.0.0.1'] });
  fireEvent.change(screen.getByLabelText('Allowed IP addresses (optional)'), { target: { value: 'fd00::1' } });
  assert.equal(edited.disabled, true);
  screen.getByText('Not an IPv4 address or CIDR range: fd00::1');
});

test('a refused update keeps the editor open and shows the reason', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  updateStatus = 409;
  const save = await openEdit({ ...billingBot, role: 'admin' });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'viewer' } });
  fireEvent.click(save);
  await screen.findByText('Cannot remove the last active admin key');
  await waitFor(() => assert.equal(save.disabled, false));
  screen.getByRole('button', { name: 'Save' });
});

test('editing the key the dashboard is signed in with warns before saving', async () => {
  window.sessionStorage.setItem('openwa_api_key', 'owa_k1abXXXXYYYYZZZZ');
  await openEdit(billingBot);
  rtl.screen.getByText(/This dashboard is signed in with this key/);
  rtl.cleanup();
  window.sessionStorage.setItem('openwa_api_key', 'owa_k1zzXXXXYYYYZZZZ');
  await openEdit(billingBot);
  assert.equal(rtl.screen.queryByText(/This dashboard is signed in with this key/) === null, true);
});

// A datetime-local with a blank segment reports value '' (as an empty field does) and sets badInput.
// jsdom never sets badInput, so it is stubbed on the element. As in a browser, assigning the element's
// value from code wipes the leftover segments; the value fireEvent.change types goes through the
// prototype setter and leaves them.
function markExpiryIncomplete(): void {
  const input = rtl.screen.getByLabelText<HTMLInputElement>('Expires at (optional)');
  let incomplete = true;
  const own = Object.getOwnPropertyDescriptor(input, 'value');
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => (own?.get ?? proto!.get!).call(input),
    set: (value: string) => {
      incomplete = false;
      (own?.set ?? proto!.set!).call(input, value);
    },
  });
  Object.defineProperty(input, 'validity', {
    configurable: true,
    get: () => ({ valid: !incomplete, badInput: incomplete }),
  });
}

const invalidExpiry =
  'Enter a complete date and time no later than the year 9999, or clear the field for a key that never expires.';

test('a half-filled expiry blocks Create and Save instead of meaning no expiry', async () => {
  const { screen, fireEvent } = rtl;
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  markExpiryIncomplete();
  fireEvent.click(create);
  await screen.findByText(invalidExpiry);
  assert.equal(createBody, undefined);

  rtl.cleanup();
  const save = await openEdit({ ...billingBot, expiresAt: '2027-03-04T05:06:59.000Z' });
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '' } });
  markExpiryIncomplete();
  fireEvent.click(save);
  await screen.findByText(invalidExpiry);
  assert.deepEqual(updateBodies, []);
});

test('Remove expiry clears a half-filled expiry so Save drops it', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  const save = await openEdit({ ...billingBot, expiresAt: '2027-03-04T05:06:59.000Z' });
  markExpiryIncomplete();
  // Deleting one segment turns the value to '' while the others stay filled.
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.click(save);
  await waitFor(() => assert.equal(updateBodies.length, 1));
  assert.deepEqual(updateBodies[0], { expiresAt: null });

  rtl.cleanup();
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '2027-03-04T05:06' } });
  markExpiryIncomplete();
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.click(create);
  await waitFor(() => assert.notEqual(createBody, undefined));
  assert.equal(createBody?.expiresAt, undefined);
});

// Typing part of a date into an empty field keeps the value at '', so the browser fires no change
// event; leaving the field (as clicking Create or Save does) must still offer Remove expiry.
test('Remove expiry appears for a partial expiry typed into an empty field', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  markExpiryIncomplete();
  fireEvent.blur(screen.getByLabelText('Expires at (optional)'));
  fireEvent.click(create);
  await screen.findByText(invalidExpiry);
  assert.equal(createBody, undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.click(create);
  await waitFor(() => assert.notEqual(createBody, undefined));
  assert.deepEqual(createBody, { name: 'crm-bot', role: 'operator', allowedSessions: [] });

  rtl.cleanup();
  const save = await openEdit(billingBot);
  markExpiryIncomplete();
  fireEvent.blur(screen.getByLabelText('Expires at (optional)'));
  fireEvent.click(save);
  await screen.findByText(invalidExpiry);
  assert.deepEqual(updateBodies, []);
  fireEvent.click(screen.getByRole('button', { name: 'Remove expiry' }));
  fireEvent.click(save);
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Save' }) === null, true));
  assert.deepEqual(updateBodies, []);
});

// Chrome takes up to six year digits in a datetime-local without a max, and new Date() cannot parse a
// five-digit year, so such a value used to reach toISOString() and throw.
test('an expiry past the year 9999 blocks Create and Save with a message', async () => {
  const { screen, fireEvent } = rtl;
  const create = await openCreate();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '20266-01-01T00:00' } });
  fireEvent.click(create);
  await screen.findByText(invalidExpiry);
  assert.equal(createBody, undefined);

  rtl.cleanup();
  const save = await openEdit(billingBot);
  fireEvent.change(screen.getByLabelText('Expires at (optional)'), { target: { value: '20266-01-01T00:00' } });
  fireEvent.click(save);
  await screen.findByText(invalidExpiry);
  assert.deepEqual(updateBodies, []);
});

async function inTimeZone(zone: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

// 9999-12-31T23:00 in New York is 10000-01-01T04:00Z, which serializes with a six-digit year the
// gateway refuses, so the cap follows the browser's offset.
test('west of UTC the expiry cap is the last minute of 9999 in UTC', () =>
  inTimeZone('America/New_York', async () => {
    const { screen, fireEvent } = rtl;
    const create = await openCreate();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm-bot' } });
    const input = screen.getByLabelText<HTMLInputElement>('Expires at (optional)');
    assert.equal(input.max, '9999-12-31T18:59');
    fireEvent.change(input, { target: { value: '9999-12-31T23:00' } });
    fireEvent.click(create);
    await screen.findByText(invalidExpiry);
    assert.equal(createBody, undefined);
  }));

// A 9999-12-31T23:59:59Z expiry reads as 10000-01-01T06:59 in Jakarta, past the input's max.
test('east of UTC a stored expiry past the cap does not block an unrelated edit', () =>
  inTimeZone('Asia/Jakarta', async () => {
    const { screen, fireEvent, waitFor } = rtl;
    const save = await openEdit({ ...billingBot, expiresAt: '9999-12-31T23:59:59.000Z' });
    assert.equal(screen.getByLabelText<HTMLInputElement>('Expires at (optional)').max, '9999-12-31T23:59');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'viewer' } });
    fireEvent.click(save);
    await waitFor(() => assert.equal(updateBodies.length, 1));
    assert.deepEqual(updateBodies[0], { role: 'viewer' });
  }));

test('an expiry Save cannot convert ends in an error toast, not a silent no-op', async () => {
  const { screen, fireEvent } = rtl;
  const save = await openEdit(billingBot);
  const input = screen.getByLabelText<HTMLInputElement>('Expires at (optional)');
  fireEvent.change(input, { target: { value: '20266-01-01T00:00' } });
  // A browser that let the value through as valid.
  Object.defineProperty(input, 'validity', { value: { valid: true }, configurable: true });
  fireEvent.click(save);
  await screen.findByText('Invalid time value');
  assert.deepEqual(updateBodies, []);
});
