import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import MediaLightbox from './MediaLightbox';

export type ArchivedMediaKind = 'image' | 'video' | 'audio';

interface ArchivedMediaPreviewProps {
  kind: ArchivedMediaKind;
  /** Fetches the archived bytes (the per-message media route). Called at most once per mount. */
  load: () => Promise<Blob>;
  alt?: string;
  /** Rendered instead of the preview when the fetch fails, the download button, so the bytes stay reachable. */
  fallback: ReactNode;
  measureMedia?: (el: Element | null) => void;
  onMediaLoad?: (event?: { currentTarget: Element | null }) => void;
}

type PreviewState = { phase: 'waiting' | 'loading' | 'failed' } | { phase: 'ready'; url: string };

// An inline preview for media whose list payload is the `{ omitted: true, archived: true }` marker,
// what MESSAGE_INLINE_MEDIA=archive leaves once the bytes are verified on the archive store. The
// archive is the only copy then, so without this an image would read as a bare "Media" button where
// it used to render. A plain over-budget marker (no `archived`) keeps the click-to-download button:
// those bytes may be multi-megabyte inline payloads, and fetching each one as it scrolls past would
// turn browsing into bulk download.
//
// Fetched lazily, once the bubble nears the viewport, so opening a media-heavy chat does not fire one
// request per archived message at once. Where IntersectionObserver is unavailable (old browsers, the
// jsdom test runtime) it loads immediately rather than never. The object URL is revoked on unmount so
// the parent's media cap unmounts older previews as the thread grows.
function ArchivedMediaPreview({ kind, load, alt, fallback, measureMedia, onMediaLoad }: ArchivedMediaPreviewProps) {
  const [state, setState] = useState<PreviewState>({ phase: 'waiting' });
  const [imageOpen, setImageOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  // `load` is usually an inline arrow, so a fresh identity every render; holding it in a ref keeps
  // the effects below from re-running (and re-fetching) on each parent render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  // The object URL the ready render points at. Revoked on unmount only, the phase never leaves
  // `ready`, so the URL stays valid for as long as the element showing it exists.
  const urlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  // Phase 1: wait until the bubble is near the viewport.
  useEffect(() => {
    if (state.phase !== 'waiting') return undefined;
    const el = anchorRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setState({ phase: 'loading' });
      return undefined;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer.disconnect();
          setState({ phase: 'loading' });
        }
      },
      // A screen's worth of lead so the bytes are usually there by the time the bubble scrolls in.
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.phase]);

  // Phase 2: fetch once. A response landing after unmount is dropped rather than turned into a URL
  // nothing would ever revoke.
  useEffect(() => {
    if (state.phase !== 'loading') return undefined;
    let cancelled = false;
    loadRef
      .current()
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ phase: 'ready', url });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  if (state.phase === 'failed') return <>{fallback}</>;

  if (state.phase !== 'ready') {
    return (
      <div ref={anchorRef} className="message-media-omitted message-media-archived-loading" aria-busy="true">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }

  switch (kind) {
    case 'image':
      return (
        <>
          <div className="message-media-image">
            <img
              src={state.url}
              alt={alt ?? ''}
              className="chat-image-media"
              ref={measureMedia}
              onLoad={onMediaLoad}
              role="button"
              tabIndex={0}
              onClick={() => setImageOpen(true)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setImageOpen(true);
                }
              }}
            />
          </div>
          <MediaLightbox
            items={[{ id: 'archived-image', url: state.url, alt, filename: alt }]}
            index={imageOpen ? 0 : null}
            onClose={() => setImageOpen(false)}
            onNavigate={() => {}}
          />
        </>
      );
    case 'video':
      return (
        <div className="message-media-video">
          <video ref={measureMedia} src={state.url} controls className="chat-video-media" onLoadedData={onMediaLoad} />
        </div>
      );
    case 'audio':
      return (
        <div className="message-media-audio">
          <audio src={state.url} controls className="chat-audio-media" />
        </div>
      );
  }
}

export default ArchivedMediaPreview;
