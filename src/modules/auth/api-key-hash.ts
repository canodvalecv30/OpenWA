import { createHash, createHmac } from 'crypto';

/**
 * Hash an API key for storage/lookup. With a server-side pepper (`API_KEY_PEPPER`) set, uses HMAC so
 * a database leak alone can't precompute candidate hashes against a guessed/user-chosen key. Without
 * a pepper it falls back to plain SHA-256 — unchanged behaviour, so existing stored hashes still
 * validate. NOTE: enabling (or changing) the pepper invalidates keys hashed before it was set, so it
 * is a deploy-time choice: set it before the first boot. On an install that already has keys every
 * key, admin included, stops authenticating, so none is left to re-issue the others through the API.
 * To recover, either restore the previous pepper, or stop the instance, delete the rows in `api_keys`
 * in the main database (`data/main.sqlite`, or `MAIN_DATABASE_NAME`) and restart: the next boot seeds
 * a new admin key (from `API_MASTER_KEY` when set), and the other keys are then re-created.
 */
export function hashApiKey(rawKey: string, pepper?: string): string {
  return pepper
    ? createHmac('sha256', pepper).update(rawKey).digest('hex')
    : createHash('sha256').update(rawKey).digest('hex');
}
