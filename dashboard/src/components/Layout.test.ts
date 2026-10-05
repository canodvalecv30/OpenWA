// The sidebar theme button cycles light, dark and "follow the system". The choice is stored, so a button
// that only flipped light and dark lost "System" for good after the first click.
import '../test-helpers/register-hooks.ts';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';

let rtl: typeof import('@testing-library/react');
let Layout: (typeof import('./Layout.tsx'))['Layout'];
let MemoryRouter: (typeof import('react-router-dom'))['MemoryRouter'];
let RoleContext: (typeof import('../hooks/useRole.tsx'))['RoleContext'];
// Every URL the layout asked for.
const requested: string[] = [];

/** The layout for an admin key, restricted to selected sessions when `scoped` is set. */
function renderLayout(scoped = false): ReturnType<typeof import('@testing-library/react').render> {
  const role = {
    role: 'admin' as const,
    setRole: () => undefined,
    isAdmin: true,
    isOperator: true,
    isViewer: false,
    canWrite: true,
    engineType: 'whatsapp-web.js',
    setEngineType: () => undefined,
    scoped,
    setScoped: () => undefined,
  };
  return rtl.render(
    createElement(
      RoleContext.Provider,
      { value: role },
      createElement(MemoryRouter, null, createElement(Layout, { onLogout: () => undefined, userRole: 'admin' })),
    ),
  );
}

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
  // jsdom has no matchMedia; the theme hook reads it for the system preference.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({ message: 'unstubbed' }), { status: 404 }));
  }) as typeof fetch;
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ Layout } = await import('./Layout.tsx'));
  ({ RoleContext } = await import('../hooks/useRole.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  requested.length = 0;
});

after(() => rtl.cleanup());

test('the theme button can return to following the system', () => {
  localStorage.removeItem('openwa_theme');
  const { container } = renderLayout();
  const button = container.querySelector<HTMLButtonElement>('.appearance-menu .theme-toggle-btn')!;
  const seen = [button.textContent];
  for (let i = 0; i < 3; i++) {
    const announced = button.getAttribute('aria-label');
    rtl.fireEvent.click(button);
    seen.push(button.textContent);
    // The label names the state the click selects.
    assert.equal(announced, `Switch to ${button.textContent}`);
  }
  assert.deepEqual(seen, ['System', 'Light', 'Dark', 'System']);
  assert.equal(localStorage.getItem('openwa_theme'), 'system');
});

// The key management, infrastructure and plugin routes refuse a key restricted to selected sessions, whatever
// its role, and every refusal lands in the audit log as a failed attempt.
test('an admin key scoped to sessions is not offered the pages that refuse it', async () => {
  renderLayout(true);
  const { screen } = rtl;
  assert.equal(screen.queryByRole('link', { name: 'API Keys' }) === null, true);
  assert.equal(screen.queryByRole('link', { name: 'Infrastructure' }) === null, true);
  assert.equal(screen.queryByRole('link', { name: 'Plugins' }) === null, true);
  // The audit read is filtered to the key's sessions, not refused.
  assert.ok(screen.getByRole('link', { name: 'Logs' }));
  await rtl.waitFor(() => assert.ok(requested.some(url => url.includes('/health'))));
  assert.equal(
    requested.some(url => url.includes('/infra/update-check')),
    false,
  );
});

test('an unscoped admin key still checks for a newer release', async () => {
  renderLayout();
  assert.ok(rtl.screen.getByRole('link', { name: 'Plugins' }));
  await rtl.waitFor(() => assert.ok(requested.some(url => url.includes('/infra/update-check'))));
});
