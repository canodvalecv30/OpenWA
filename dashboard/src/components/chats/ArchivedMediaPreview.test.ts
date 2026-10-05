// Render test for the archive-only media preview: an `{ omitted: true, archived: true }` marker must
// still show its image/video/audio inline (fetched from the media route), release the object URL it
// made, and fall back to the download button when the bytes cannot be fetched.
import '../../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';

type RTL = typeof import('@testing-library/react');

let rtl: RTL;
let ArchivedMediaPreview: typeof import('./ArchivedMediaPreview.tsx').default;

const created: string[] = [];
const revoked: string[] = [];

before(async () => {
  const { installJsdomGlobals } = await import('../../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  rtl = await import('@testing-library/react');
  ({ default: ArchivedMediaPreview } = await import('./ArchivedMediaPreview.tsx'));
  // jsdom implements neither.
  URL.createObjectURL = (): string => {
    const url = `blob:mock-${created.length}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => void revoked.push(url);
});

afterEach(() => {
  rtl.cleanup();
  created.length = 0;
  revoked.length = 0;
});

const fallback = createElement('button', { type: 'button', className: 'message-media-omitted' }, 'Media');

test('an archived image loads once from the media route and renders from an object URL', async () => {
  let calls = 0;
  const { container, unmount } = rtl.render(
    createElement(ArchivedMediaPreview, {
      kind: 'image',
      alt: 'photo.jpg',
      fallback,
      load: async () => {
        calls += 1;
        return new Blob(['x'], { type: 'image/jpeg' });
      },
    }),
  );
  const img = await rtl.waitFor(() => {
    const found = container.querySelector('img.chat-image-media');
    assert.ok(found, 'the archived image did not render');
    return found as HTMLImageElement;
  });
  assert.equal(img.getAttribute('src'), 'blob:mock-0');
  assert.equal(calls, 1, 'the bytes are fetched exactly once');
  assert.deepEqual(revoked, [], 'the URL stays valid while the image is on screen');
  rtl.fireEvent.click(img);
  const dialog = await rtl.screen.findByRole('dialog');
  assert.ok(dialog.querySelector('img[src="blob:mock-0"]'), 'the viewer uses the already loaded bytes');
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Close' }));
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 500)));
  assert.equal(rtl.screen.queryByRole('dialog'), null);
  assert.equal(calls, 1, 'opening the viewer does not fetch the image again');
  assert.deepEqual(revoked, [], 'closing the viewer keeps the preview URL valid');
  rtl.fireEvent.keyDown(img, { key: 'Enter' });
  assert.ok(rtl.screen.getByRole('dialog'), 'the viewer opens from the keyboard');
  unmount();
  assert.deepEqual(revoked, ['blob:mock-0'], 'unmounting releases the object URL');
});

test('video and audio render their own elements', async () => {
  for (const [kind, selector] of [
    ['video', 'video.chat-video-media'],
    ['audio', 'audio.chat-audio-media'],
  ] as const) {
    const { container } = rtl.render(
      createElement(ArchivedMediaPreview, { kind, fallback, load: async () => new Blob(['x']) }),
    );
    await rtl.waitFor(() => assert.ok(container.querySelector(selector), `${kind} did not render`));
    rtl.cleanup();
  }
});

test('a failed fetch falls back to the download button instead of a broken preview', async () => {
  const { container } = rtl.render(
    createElement(ArchivedMediaPreview, {
      kind: 'image',
      fallback,
      load: async () => {
        throw new Error('404');
      },
    }),
  );
  await rtl.waitFor(() => assert.ok(container.querySelector('button.message-media-omitted')));
  assert.equal(container.querySelector('img'), null);
  assert.deepEqual(created, [], 'no object URL is made for a failed fetch');
});

test('a response landing after unmount makes no object URL', async () => {
  let resolve!: (blob: Blob) => void;
  const { unmount } = rtl.render(
    createElement(ArchivedMediaPreview, {
      kind: 'image',
      fallback,
      load: () => new Promise<Blob>(r => (resolve = r)),
    }),
  );
  await rtl.waitFor(() => assert.ok(resolve, 'the fetch did not start'));
  unmount();
  resolve(new Blob(['x']));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(created, [], 'a late response must not leak a URL nothing will revoke');
});
