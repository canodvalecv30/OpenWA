import { type createLogger } from '../../common/services/logger.service';

/** The narrow slice of the Puppeteer page this check needs, so nothing here depends on puppeteer. */
export interface EvaluatablePage {
  evaluate<T>(fn: () => T): Promise<T>;
}

/**
 * Page-side probe: is whatsapp-web.js' incoming-call hook installed on this page?
 *
 * The library detects a call by replacing ONE function, the call collection's internal `Map.set`
 * (`Client.js`, attachEventListeners). A patched `set` is a JS function; an untouched one stringifies
 * with `[native code]`. Returns `null` when the collection is not in the page's module graph at all,
 * which is not the same answer as "the hook is missing".
 */
function readCallHookState(): boolean | null {
  const w = window as unknown as { require?: (name: string) => Record<string, unknown> | undefined };
  if (typeof w.require !== 'function') return null;
  let collection: Record<string, unknown> | undefined;
  try {
    collection = w.require('WAWebCallCollection');
  } catch {
    return null;
  }
  if (!collection) return null;
  const owned = collection;
  const mapKey = Object.keys(owned).find(key => owned[key] instanceof Map);
  if (!mapKey) return null;
  const setter = (owned[mapKey] as { set: unknown }).set;
  return !String(setter).includes('[native code]');
}

/**
 * Warn when a ready session's page carries no call hook.
 *
 * whatsapp-web.js installs the call hook in the same `evaluate` as its message listeners, and that
 * evaluate has no `try`/`catch`: a module that stops resolving earlier in it leaves the message
 * bridge registered and the call hook silently absent. The session then looks completely healthy,
 * keeps delivering messages, and never reports a single incoming call. Operators have no way to see
 * that from the outside, so say it in the log.
 *
 * Deliberately advisory: it never changes the session's status. Detection is the only thing lost,
 * and a false alarm on an inconclusive read would send operators after a problem they do not have.
 */
export async function reportMissingCallHook(
  page: EvaluatablePage | undefined,
  logger: ReturnType<typeof createLogger>,
  sessionId: string,
): Promise<void> {
  if (!page) return;
  let installed: boolean | null;
  try {
    installed = await page.evaluate(readCallHookState);
  } catch {
    return; // a page that died mid-read says nothing about the hook
  }
  if (installed !== false) return;
  logger.warn(
    'Incoming calls cannot be detected on this session: the page-side call hook is not installed. ' +
      'Messages are unaffected; restart the session to reinject it.',
    { sessionId, action: 'call_hook_missing' },
  );
}
