// Render test for the Templates page under the bare `node --test` runner, on the Sessions.test.ts
// harness. The template list route is OPERATOR-only, so a viewer key always gets 403 there; a failed
// read must say so instead of rendering the "no templates saved" empty state.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let templatesStatus = 200;
let sessionsStatus = 200;
// When set, GET /api/sessions answers only once this settles, holding the page on its first load.
let sessionsGate: Promise<void> | null = null;
// Sessions listed after the default one, which is dropped while `firstSessionGone` is set.
let extraSessions: Array<{ id: string; name: string }> = [];
let firstSessionGone = false;
let templates: Array<{ id: string; name: string; body: string }> = [];
const deleted: string[] = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function installFetchStub(): void {
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/sessions') {
      if (sessionsGate) return sessionsGate.then(() => jsonResponse([]));
      if (sessionsStatus !== 200) return Promise.resolve(jsonResponse({ message: 'gateway restarting' }, 502));
      const rows = [{ id: 'sess-1', name: 'billing-bot' }, ...extraSessions].filter(
        row => !firstSessionGone || row.id !== 'sess-1',
      );
      return Promise.resolve(
        jsonResponse(
          rows.map(row => ({
            ...row,
            status: 'ready',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          })),
        ),
      );
    }
    if (path === '/api/sessions/sess-2/templates') {
      return Promise.resolve(jsonResponse([{ id: 'tpl-2', name: 'support-greeting', body: 'Hello' }]));
    }
    if (path === '/api/sessions/sess-1/templates') {
      if (templatesStatus === 403) {
        return Promise.resolve(jsonResponse({ message: 'Insufficient permissions. Required: operator' }, 403));
      }
      if (templatesStatus !== 200)
        return Promise.resolve(jsonResponse({ message: 'database offline' }, templatesStatus));
      return Promise.resolve(jsonResponse(templates));
    }
    const rowMatch = /^\/api\/sessions\/sess-1\/templates\/(.+)$/.exec(path);
    if (rowMatch) {
      deleted.push(rowMatch[1]);
      templates = templates.filter(t => t.id !== rowMatch[1]);
      return Promise.resolve(jsonResponse({ success: true }));
    }
    return Promise.resolve(jsonResponse({ message: `unstubbed ${path}` }, 404));
  }) as typeof fetch;
}

let rtl: typeof import('@testing-library/react');
let Templates: (typeof import('./Templates.tsx'))['Templates'];
let RoleProvider: (typeof import('../components/RoleProvider.tsx'))['RoleProvider'];
let ToastProvider: (typeof import('../components/Toast.tsx'))['ToastProvider'];
let queryClient: QueryClient | undefined;

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  installFetchStub();
  window.sessionStorage.setItem('openwa_user_role', 'viewer');
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ RoleProvider } = await import('../components/RoleProvider.tsx'));
  ({ ToastProvider } = await import('../components/Toast.tsx'));
  ({ Templates } = await import('./Templates.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  queryClient?.clear();
  queryClient = undefined;
  sessionsStatus = 200;
  templatesStatus = 200;
  templates = [];
  extraSessions = [];
  firstSessionGone = false;
});

function renderTemplates(): void {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RoleProvider, null, createElement(ToastProvider, null, createElement(Templates))),
    ),
  );
}

// The row button exists so a template can be deleted without opening it in the editor first, and it
// is gated on the same write permission as the editor's own delete. Both halves are pinned here.
test('a write key can delete a template from its row, and a read-only key cannot', async () => {
  const { screen, fireEvent, within, waitFor } = rtl;
  templatesStatus = 200;
  templates = [{ id: 'tpl-1', name: 'invoice-reminder', body: 'Hi {{name}}' }];
  deleted.length = 0;

  window.sessionStorage.setItem('openwa_user_role', 'operator');
  renderTemplates();

  const row = (await screen.findByText('invoice-reminder')).closest('.template-list-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

  // The confirm names the template, so a mis-click on a crowded list is recoverable.
  const dialog = await screen.findByRole('dialog');
  assert.ok(within(dialog).getByText(/invoice-reminder/), 'the confirm did not name the template');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => assert.deepEqual(deleted, ['tpl-1'], 'the delete never reached the API'));

  rtl.cleanup();
  window.sessionStorage.setItem('openwa_user_role', 'viewer');
  templates = [{ id: 'tpl-1', name: 'invoice-reminder', body: 'Hi {{name}}' }];
  renderTemplates();

  const readOnlyRow = (await screen.findByText('invoice-reminder')).closest('.template-list-row') as HTMLElement;
  assert.equal(
    within(readOnlyRow).queryByRole('button', { name: 'Delete' }) === null,
    true,
    'a read-only key was offered the row delete',
  );
});

test('a 403 on the template list shows a permission state, not an empty library', async () => {
  templatesStatus = 403;
  renderTemplates();
  await rtl.screen.findByText('No access to templates');
  assert.equal(rtl.screen.queryByText('No templates saved') === null, true);
});

test('any other failed read shows the error, not an empty library', async () => {
  templatesStatus = 500;
  renderTemplates();
  await rtl.screen.findByText('Could not load templates');
  rtl.screen.getByText('database offline');
  assert.equal(rtl.screen.queryByText('No templates saved') === null, true);
});

test('a successful empty read still shows the empty state', async () => {
  renderTemplates();
  // Before a session is selected the templates read has not started and the list is briefly empty, so
  // only the settled read can tell an empty library from a loaded one.
  await rtl.waitFor(() =>
    assert.equal(queryClient!.getQueryState(['sessions', 'sess-1', 'templates'])?.status, 'success'),
  );
  await rtl.screen.findByText('No templates saved');
});

// Between the sessions read and the effect that selects the first session, no templates read has
// started yet; that frame must show the loading state, not claim the library is empty.
test('a library with templates never flashes the empty state while the first session is selected', async () => {
  templates = [{ id: 'tpl-1', name: 'invoice-reminder', body: 'Hi {{name}}' }];
  let sawEmpty = false;
  const observer = new MutationObserver(() => {
    if (document.body.textContent?.includes('No templates saved')) sawEmpty = true;
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  try {
    renderTemplates();
    await rtl.screen.findByText('invoice-reminder');
  } finally {
    observer.disconnect();
  }
  assert.equal(sawEmpty, false, 'the empty state rendered before the templates read started');
});

test('a failed sessions read shows the error, not "no sessions available"', async () => {
  sessionsStatus = 502;
  renderTemplates();
  const alert = await rtl.screen.findByRole('alert');
  rtl.within(alert).getByText('Failed to load data');
  rtl.within(alert).getByText('gateway restarting');
  assert.equal(rtl.screen.queryByText('No sessions available') === null, true);
  assert.equal(rtl.screen.queryByRole('option', { name: 'No sessions' }) === null, true);
});

// The full-page loader puts both classes on the page root itself, so its rule must be a compound
// selector: a descendant one never matches, leaving the spinner in the top-left corner.
test('the first-load spinner is centered in a 400px block', async () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('./Templates.css', import.meta.url), 'utf8');
  document.head.appendChild(style);
  let release!: () => void;
  sessionsGate = new Promise<void>(resolve => (release = resolve));
  try {
    renderTemplates();
    const loader = document.querySelector('.templates-loading') as HTMLElement;
    assert.ok(loader, 'the page did not render its loading state');
    const computed = getComputedStyle(loader);
    assert.equal(computed.display, 'flex');
    assert.equal(computed.justifyContent, 'center');
    assert.equal(computed.minHeight, '400px');
  } finally {
    release();
    sessionsGate = null;
    style.remove();
  }
});

// A session deleted elsewhere drops out of the list on the next read. Kept selected, it matches no
// option, so the select shows another session while the list and every write still target the gone one.
test('a selected session that disappears from the list is replaced by the first remaining one', async () => {
  const { screen, act } = rtl;
  templatesStatus = 200;
  templates = [{ id: 'tpl-1', name: 'invoice-reminder', body: 'Hi {{name}}' }];
  extraSessions = [{ id: 'sess-2', name: 'support-bot' }];
  window.sessionStorage.setItem('openwa_user_role', 'operator');
  renderTemplates();

  await screen.findByText('invoice-reminder');
  const select = screen.getByLabelText<HTMLSelectElement>('Session');
  assert.equal(select.value, 'sess-1');

  firstSessionGone = true;
  await act(() => queryClient!.refetchQueries({ queryKey: ['sessions'], exact: true }));

  await screen.findByText('support-greeting');
  assert.equal(select.value, 'sess-2');
  assert.equal(screen.queryByText('invoice-reminder') === null, true);
  screen.getByText('Saved under support-bot');
  window.sessionStorage.setItem('openwa_user_role', 'viewer');
});

// The count above the list still shows the library is not empty, so a search that matches nothing
// must say so rather than claim no templates are saved.
test('a search with no match says so instead of reporting an empty library', async () => {
  const { screen, fireEvent } = rtl;
  templatesStatus = 200;
  templates = [{ id: 'tpl-1', name: 'invoice-reminder', body: 'Hi {{name}}' }];
  renderTemplates();

  await screen.findByText('invoice-reminder');
  fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'no-such-template' } });
  await screen.findByText('No templates match your search.');
  assert.equal(screen.queryByText('No templates saved') === null, true);
});

// Hebrew and Arabic flip the three-column grid. A physical left or right edge then lands on the
// workspace's outer border instead of between the columns, and left-aligned text reads backwards.
test('the workspace columns and list rows follow the text direction', () => {
  const css = readFileSync(new URL('./Templates.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /border-(left|right)\s*:/, 'a column divider uses a physical side');
  assert.doesNotMatch(css, /text-align\s*:\s*(left|right)\b/, 'text is aligned to a physical side');
});
