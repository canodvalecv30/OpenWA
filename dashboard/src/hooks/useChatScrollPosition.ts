import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { decideScroll, type ScrollDirection } from '../utils/scrollDecision.ts';

/**
 * Decide the restore target on a chat switch or load-resolve.
 *
 * Inputs:
 *   - nextChatId: chat we are ENTERING (or null if no chat selected)
 *   - isLoaded:   is the next chat's content rendered now?
 *   - savedScrollTop: previously-saved scrollTop for nextChatId (or undefined)
 *
 * Output: { restore: 'saved' | 'bottom' | null }
 *   - restore: 'saved' = write scrollTop = the saved value; 'bottom' = scrollHeight;
 *              null = do nothing (still loading / deselected).
 *
 * NOTE: there is deliberately no "save the leaving chat's scrollTop" step here. A layout effect
 * runs AFTER React has already swapped the container's content to the NEW chat, so a post-swap
 * read captures the NEW content's (possibly clamped) scrollTop, not the leaving chat's position —
 * saving then restores the returning chat to the TOP. Instead the scroll listener saves the live
 * scrollTop continuously (see below), so the map always holds each chat's last REAL position.
 *
 * This is a pure function so it can be unit-tested without React.
 */
export interface RestoreDecision {
  restore: 'saved' | 'bottom' | null;
}

export function decideRestoreTarget(
  nextChatId: string | null,
  isLoaded: boolean,
  savedScrollTop: number | undefined,
): RestoreDecision {
  const restore: 'saved' | 'bottom' | null =
    nextChatId !== null && isLoaded ? (savedScrollTop !== undefined ? 'saved' : 'bottom') : null;

  return { restore };
}

/**
 * Per-chat scroll-position memory + auto-scroll heuristic.
 *
 * - On chat switch (and once content for the new chat has actually rendered):
 *   saves the leaving chat's scrollTop, restores the entering chat's saved
 *   scrollTop, or jumps to bottom on first visit. All synchronously, before
 *   paint, via useLayoutEffect — no visible "jump" or smooth-scroll animation.
 * - The hook depends on BOTH activeChatId AND isLoaded so that a cold-open
 *   (spinner first, then data) correctly waits to restore until the messages
 *   list is mounted with non-zero scrollHeight.
 * - On message append: `onMessageAppended(direction)` snapshots the geometry
 *   BEFORE the new message is committed, then defers the scroll-to-bottom (if
 *   any) to the next frame so the new message is already in the DOM.
 * - Pinned-to-bottom: media (`<img>`/`<video>`) has no intrinsic size before it
 *   decodes, so the container's scrollHeight GROWS after the initial restore —
 *   silently un-bottoming the view (the thread looks like it "opened at the
 *   top"). While pinned, each `onMediaLoad` re-pins to the bottom; the pin
 *   releases as soon as the USER scrolls away from the bottom (and re-arms when
 *   they scroll back), so late-decoding media never yanks a reading user.
 * - Reading further back: the same late-decode growth, above a viewport that is
 *   NOT pinned to the bottom, holds the user's position instead of re-pinning.
 *   That is `onMediaLoad`'s third branch. The baseline comes from
 *   `measureMedia`, a ref callback that records each element's box height at
 *   DOM insertion, because a height read inside the load handler is already
 *   post-decode and would measure the growth as zero. It corrects only for
 *   media above the reading position: growth below it moves nothing on screen.
 *
 * Mount the returned `containerRef` on the scroll container (the `.room-messages`
 * div in Chats.tsx). The Map of saved positions lives in a ref so it doesn't
 * trigger renders and is garbage-collected when the host component unmounts.
 */

/** Distance from the bottom (px) within which the user still counts as "at the bottom". */
const BOTTOM_PIN_THRESHOLD_PX = 24;

/** Pure geometry check, exported for tests: is the viewport (nearly) at the container's bottom? */
export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_PIN_THRESHOLD_PX;
}

/**
 * Whether media that just finished loading sits above the reading position, taking both edges in
 * viewport coordinates. This is the one distinction native scroll anchoring made, and the reason
 * the correction cannot be a bare `scrollHeight` delta: growth BELOW the fold moves nothing on
 * screen, so adding it to `scrollTop` would drag the reader toward the newest messages instead of
 * holding them still. The thread is not virtualized, so every image between the reader and the
 * bottom fires one of these.
 *
 * Media straddling the top edge answers false. Only the part above the edge displaces anything, so
 * a full correction would overshoot, and leaving it uncorrected errs in the direction the reader
 * was already travelling rather than against it.
 */
export function grewAboveReadingPosition(mediaBottom: number, containerTop: number): boolean {
  return mediaBottom <= containerTop;
}

/**
 * How much `scrollTop` must gain to hold the reader still after a media element finished decoding,
 * or null when nothing on screen moved. This is a DELTA, not an absolute target, so the caller adds
 * it to the LIVE scrollTop at apply time: two elements decoding in one frame each contribute their
 * own growth and the reader is held through the sum, where a captured absolute would have the second
 * write overwrite the first with the same value and under-correct.
 *
 * `seededHeight` is the element's box height recorded when it MOUNTED. That matters: by the time a
 * `load` handler runs, the decoded size is already in layout, and every geometry read there flushes
 * it, so a baseline taken in the handler measures the growth as zero and the correction never
 * fires. DOM insertion is the one moment a browser guarantees is pre-decode.
 *
 * The growth is subtracted from the bottom edge before the above/below question is asked, because
 * `mediaBottom` is read post-decode: an element that displaced the reader can already measure below
 * the container's top edge by exactly the amount it grew.
 */
export function correctionForMediaGrowth(
  seededHeight: number,
  currentHeight: number,
  mediaBottom: number,
  containerTop: number,
): number | null {
  const grew = currentHeight - seededHeight;
  if (grew <= 0) return null;
  return grewAboveReadingPosition(mediaBottom - grew, containerTop) ? grew : null;
}

export function useChatScrollPosition(
  activeChatId: string | null,
  isLoaded: boolean,
  isFetchingOlderMessages: boolean,
): {
  containerRef: RefObject<HTMLDivElement | null>;
  onMessageAppended: (direction: ScrollDirection) => void;
  /** Pass the load event through: which element grew decides whether the reader moved at all. */
  onMediaLoad: (event?: { currentTarget: Element | null }) => void;
  /** Ref callback for every inline media element; seeds the pre-decode height onMediaLoad needs. */
  measureMedia: (el: Element | null) => void;
  /** Call when an older page is requested; the reading position is held once it lands. */
  onOlderMessagesRequested: () => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollMap = useRef<Map<string, number>>(new Map());
  const prevChatIdRef = useRef<string | null>(null);
  const pinnedRef = useRef<boolean>(true);
  // Whether the visible chat's messages have rendered. While a chat loads, the container shows only a
  // spinner and the browser clamps scrollTop to it; that clamp arrives as a scroll event and is not a
  // position to remember.
  const loadedRef = useRef<boolean>(false);
  // A 'saved' restore writes scrollTop BEFORE media decodes — the browser clamps the write to the
  // still-short scrollHeight and the thread lands at the top. The saved value lives here and is
  // re-applied on every media decode until the user scrolls (any genuine scroll cancels it).
  const pendingRestoreRef = useRef<number | null>(null);
  // Marks our own writes so the scroll listener can skip them (a genuine user scroll both updates
  // the pin state / position map AND cancels pendingRestore; our writes must do neither).
  const programmaticWriteRef = useRef<boolean>(false);
  // See the layout effect below.
  const prevScrollHeightRef = useRef<number>(0);
  const awaitingOlderPageRef = useRef<boolean>(false);
  const wasFetchingOlderRef = useRef<boolean>(false);
  // Box height of each mounted media element, recorded at DOM insertion: the one moment a browser
  // guarantees is before the decode. A WeakMap so entries die with the nodes on a chat switch.
  const mediaHeights = useRef(new WeakMap<Element, number>());

  const writeScrollTop = useCallback((el: HTMLDivElement, top: number) => {
    const before = el.scrollTop;
    programmaticWriteRef.current = true;
    el.scrollTop = top;
    // No scroll event fires when the value doesn't change (or clamps to the same value) — don't
    // leave the flag set to swallow the next genuine user scroll.
    if (el.scrollTop === before) programmaticWriteRef.current = false;
  }, []);

  const pinToBottom = useCallback(
    (el: HTMLDivElement) => {
      writeScrollTop(el, el.scrollHeight);
      pinnedRef.current = true;
    },
    [writeScrollTop],
  );

  // Track pin state from scroll geometry: any scroll that lands at the bottom (ours or the user's)
  // pins; any scroll away (only ever the user's) unpins. The SAME listener saves the visible
  // chat's scrollTop on every genuine user scroll, so the per-chat position map always holds the
  // last REAL user position — saving at switch time would read post-swap (clamped) geometry and
  // restore garbage.
  // NOTE: an effect without a dep array re-runs on EVERY render, and React runs the previous
  // cleanup first — so the listener must be (re)attached unconditionally each run.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      if (programmaticWriteRef.current) {
        programmaticWriteRef.current = false;
        return;
      }
      // A genuine user scroll: cancels any pending restore, then updates pin + position map.
      pendingRestoreRef.current = null;
      pinnedRef.current = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
      const visibleChatId = prevChatIdRef.current;
      if (visibleChatId && loadedRef.current) scrollMap.current.set(visibleChatId, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  });

  useLayoutEffect(() => {
    const next = activeChatId;
    const el = containerRef.current;
    // A new restore decision supersedes any pending one (it belongs to a different chat/visit).
    pendingRestoreRef.current = null;
    // Same for a page still in flight: its delta belongs to the thread being left. This effect is
    // declared before the height tracker, so the flag is gone before the tracker could act on it.
    if (next !== prevChatIdRef.current) awaitingOlderPageRef.current = false;

    const decision = decideRestoreTarget(next, isLoaded, next !== null ? scrollMap.current.get(next) : undefined);

    if (el) {
      if (decision.restore === 'saved' && next !== null) {
        const saved = scrollMap.current.get(next);
        if (saved !== undefined) {
          pendingRestoreRef.current = saved; // re-applied on media loads until the user scrolls
          writeScrollTop(el, saved);
          pinnedRef.current = false; // a saved spot is (almost always) not the bottom
        }
      } else if (decision.restore === 'bottom') {
        pinToBottom(el);
      }
    }

    prevChatIdRef.current = next;
    loadedRef.current = isLoaded;
  }, [activeChatId, isLoaded, pinToBottom, writeScrollTop]);

  // Older messages are prepended ABOVE the viewport, so the thread grows upward and what the user
  // was reading is pushed down by however much taller it just got. Left alone the view jumps
  // backwards at the exact moment they asked for more.
  //
  // The height is read when the page is REQUESTED and the delta applied on the commit where the
  // in-flight flag falls — not on the first commit whose height changed, because the older-page
  // spinner is an in-flow child of this same container (ChatThread) and its own ~46px arrives one
  // commit earlier. Only `scrollHeight` is held; `scrollTop` is read live at apply time, so a
  // deliberate reposition made during the fetch survives. The pin/restore machinery above is not
  // reused: it writes an ABSOLUTE target, which is unknowable here.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const wasFetching = wasFetchingOlderRef.current;
    wasFetchingOlderRef.current = isFetchingOlderMessages;
    // The FALLING edge, not merely "not fetching": the request is made in a scroll handler and the
    // query only reports itself in flight a turn later, so any commit in between — a live message,
    // a media decode, another query resolving — would otherwise consume the pending correction.
    if (!el || isFetchingOlderMessages || !wasFetching || !awaitingOlderPageRef.current) return;
    awaitingOlderPageRef.current = false;
    // A live message landing mid-fetch is inside this delta too, and it grew the thread at the
    // BOTTOM where no correction is wanted — one bubble of overshoot in that race, against a whole
    // page of it if the prepend went uncorrected.
    const grew = el.scrollHeight - prevScrollHeightRef.current;
    if (grew > 0) {
      const corrected = el.scrollTop + grew;
      writeScrollTop(el, corrected);
      // writeScrollTop marks this as a programmatic write, so the scroll listener's own
      // scrollMap.set skips it — without saving it here too, the map keeps whatever the user's
      // last REAL scroll left there, which is necessarily above the paging threshold (that is
      // what triggered this fetch). Leaving without scrolling again and coming back would restore
      // to that stale, too-high spot instead of the corrected one actually being read.
      if (activeChatId !== null) scrollMap.current.set(activeChatId, corrected);
    }
  });

  const onOlderMessagesRequested = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    prevScrollHeightRef.current = el.scrollHeight;
    awaitingOlderPageRef.current = true;
  }, []);

  const onMessageAppended = useCallback(
    (direction: ScrollDirection) => {
      const el = containerRef.current;
      if (!el) return;
      const action = decideScroll(direction, {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
      if (action === 'preserve') return;
      requestAnimationFrame(() => {
        const cur = containerRef.current;
        if (cur) pinToBottom(cur);
      });
    },
    [pinToBottom],
  );

  // Media has no layout box before it decodes. While pinned, each decode re-pins to the bottom;
  // while a 'saved' restore is pending, each decode RE-APPLIES the saved scrollTop (the first write
  // was clamped to the pre-decode scrollHeight). A user scroll clears both, so late-decoding media
  // never yanks a reading user.
  //
  // Reading further back through media-heavy history is the third case: not pinned, nothing
  // pending. A decode above the viewport still grows the thread with no reserved box (there is no
  // width/height in the media metadata to size one from up front), pushing what the user is
  // reading down exactly like an unabsorbed older-page prepend, and it is held the same way. The
  // decode has no request event to hang a snapshot on, so the baseline is taken here, from the
  // load event itself, and the element that fired it says whether the reader moved at all.
  /** Attach to every inline media element: seeds its pre-decode height for onMediaLoad. */
  const measureMedia = useCallback((el: Element | null) => {
    if (el) mediaHeights.current.set(el, el.getBoundingClientRect().height);
  }, []);

  const onMediaLoad = useCallback(
    (event?: { currentTarget: Element | null }) => {
      const pending = pendingRestoreRef.current;
      if (pending !== null) {
        requestAnimationFrame(() => {
          const cur = containerRef.current;
          if (cur && pendingRestoreRef.current !== null) writeScrollTop(cur, pending);
        });
        return;
      }
      if (pinnedRef.current) {
        requestAnimationFrame(() => {
          const cur = containerRef.current;
          if (cur && pinnedRef.current) pinToBottom(cur);
        });
        return;
      }
      const el = containerRef.current;
      if (!el) return;
      // An older page in flight already owns this growth: the landing effect diffs against a
      // request-time snapshot that spans every commit until the page lands, decodes included.
      // Correcting here as well would count the same pixels twice and overshoot by the decode.
      if (awaitingOlderPageRef.current) return;
      // Which element grew, and by how much, decides whether the reader moved at all.
      const media = event?.currentTarget ?? null;
      if (!media) return;
      const seeded = mediaHeights.current.get(media);
      if (seeded === undefined) return;
      const rect = media.getBoundingClientRect();
      // Re-seed before the frame: the element has finished growing, so its current box is the
      // baseline for any later change (a re-decode on a src swap, a lazy dimension arriving).
      mediaHeights.current.set(media, rect.height);
      const grew = correctionForMediaGrowth(seeded, rect.height, rect.bottom, el.getBoundingClientRect().top);
      if (grew === null) return;
      requestAnimationFrame(() => {
        const cur = containerRef.current;
        if (!cur) return;
        // The container is reused across chats, so a switch between the event and this frame would
        // apply the correction to a different thread and save it under the outgoing chat's id.
        // prevChatIdRef holds whichever chat is actually on screen, set by the restore effect above.
        if (prevChatIdRef.current !== activeChatId) return;
        // Add to the LIVE scrollTop, not a value captured at event time: a sibling element decoding
        // in the same frame has its own rAF that already moved scrollTop, and this one must stack on
        // top of it. A captured absolute would re-assert the pre-sibling position and lose the sum.
        const next = cur.scrollTop + grew;
        writeScrollTop(cur, next);
        if (activeChatId !== null) scrollMap.current.set(activeChatId, next);
      });
    },
    [activeChatId, pinToBottom, writeScrollTop],
  );

  return { containerRef, onMessageAppended, onMediaLoad, measureMedia, onOlderMessagesRequested };
}
