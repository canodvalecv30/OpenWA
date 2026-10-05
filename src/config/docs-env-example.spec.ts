import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `.env.example` calls itself "the Single Source of Truth for all configuration", and both
 * `charts/openwa/values.yaml` and `docs/10-devops-infrastructure.md` defer to it as the canonical
 * list. Nothing kept it complete, and it drifted: seven live operator knobs were missing, including
 * `SERVE_DASHBOARD`, which `docker-compose.yml` forwards explicitly. An operator who wanted to run
 * API-only was told the canonical list was this file, found no toggle, and concluded the capability
 * did not exist.
 *
 * The expected set is the union of three enumerations this repo already maintains by hand. It is
 * deliberately NOT derived by scanning read sites: environment variables are read through at least
 * four distinct shapes (`process.env.X`, `process.env['X']`, `env.X`, `env['X']`) plus bare string
 * literals, and a four-pattern scan measured during design still missed six keys that are
 * demonstrably live while dragging in enum members as false positives. The enumerations are exact,
 * so precision is chosen over recall — a key outside all three is simply not yet claimed by this
 * gate, and adding it to `env.validation.ts` brings it in.
 */
describe('.env.example lists the keys the codebase claims', () => {
  const REPO = join(__dirname, '..', '..');
  const read = (...parts: string[]): string => readFileSync(join(REPO, ...parts), 'utf8');

  /**
   * Documented legacy aliases. `.env.example` carries the canonical `S3_ACCESS_KEY_ID` /
   * `S3_SECRET_ACCESS_KEY`; these two spellings are accepted for backward compatibility and are
   * deliberately not advertised to new operators.
   */
  const LEGACY_ALIASES = new Set(['S3_ACCESS_KEY', 'S3_SECRET_KEY']);

  /** Keys enumerated as array elements, one per line — the shape both config files use. */
  const arrayLiteralKeys = (...parts: string[]): Set<string> =>
    new Set([...read(...parts).matchAll(/^\s*'([A-Z][A-Z0-9_]{2,})',/gm)].map(match => match[1]));

  /**
   * Keys compose forwarded as `${KEY:-}`. Comment lines are skipped: docker-compose.yml explains the
   * convention using a literal `${VAR:-}`, which an unfiltered scan reads as a key named `VAR`.
   */
  const composeForwardedKeys = (): Set<string> => {
    const keys = new Set<string>();
    for (const line of read('docker-compose.yml').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      for (const match of line.matchAll(/\$\{([A-Z][A-Z0-9_]*):-/g)) keys.add(match[1]);
    }
    return keys;
  };

  /** Keys the example file assigns, whether commented out or live. */
  const exampleKeys = (): Set<string> =>
    new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]));

  const missingFrom = (expected: Set<string>, listed: Set<string>): string[] =>
    [...expected].filter(key => !listed.has(key) && !LEGACY_ALIASES.has(key)).sort();

  it('lists every key the validator, the precedence list or compose knows about', () => {
    const validated = arrayLiteralKeys('src', 'config', 'env.validation.ts');
    const precedence = arrayLiteralKeys('src', 'config', 'env-precedence.ts');
    const forwarded = composeForwardedKeys();
    const listed = exampleKeys();

    // Guard every extractor on both sides: one that silently matched nothing would make this vacuous.
    expect(validated.size).toBeGreaterThan(50);
    expect(precedence.size).toBeGreaterThan(50);
    expect(forwarded.size).toBeGreaterThan(50);
    expect(listed.size).toBeGreaterThan(150);

    const expected = new Set([...validated, ...precedence, ...forwarded]);
    expect(expected.size).toBeGreaterThan(100);

    expect(missingFrom(expected, listed)).toEqual([]);
  });

  // The gate's own control: drop a key that is definitely listed and assert the comparison names it.
  it('reports a key dropped from the example file', () => {
    const listed = exampleKeys();
    const victim = 'PORT';
    expect(listed.has(victim)).toBe(true);

    const without = new Set([...listed].filter(key => key !== victim));
    expect(missingFrom(new Set([victim]), without)).toEqual([victim]);
  });

  it('does not report a legacy alias', () => {
    expect(missingFrom(new Set(['S3_ACCESS_KEY']), new Set())).toEqual([]);
  });
});
