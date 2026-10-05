import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guard for the "gate that never ran" class of bug.
 *
 * Every CLI script here is BOTH a module its spec imports and a command CI runs, so each needs a
 * self-invocation guard. Get that guard wrong and the failure is silent in the worst direction: the
 * script exits 0 having executed nothing, and the job it backs reports a pass.
 *
 * Two forms were wrong. `import.meta.url === \`file://${process.argv[1]}\`` compares a
 * percent-encoded URL against a raw native path, so any checkout path needing escaping (a space, a
 * `#`, non-ASCII) silently disabled the gate, and on Windows it never matched at all. A basename
 * match built with `process.argv[1].split('/')` finds no separator in a Windows path and is loose
 * enough to fire for an unrelated script of the same name.
 *
 * The correct comparison is real path against decoded URL. A resolved path is not enough: Node
 * realpaths the main module's URL but not argv[1], so a run through a symlink (/tmp on macOS)
 * never matched and exited 0 having checked nothing. This test pins it for every script rather
 * than for the two that were caught.
 */
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Anything that looks like a main-module check, however it is spelled. */
const GUARD_LINE = /process\.argv\[1\]|import\.meta\.url\s*===/;

/** The one shape that is correct on every platform and every path. */
const CORRECT_GUARD = /realpathSync\(process\.argv\[1\]\)\s*===\s*fileURLToPath\(import\.meta\.url\)/;

const BANNED = [
  { pattern: /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/, why: 'compares a percent-encoded URL against a raw native path' },
  { pattern: /process\.argv\[1\]\.split\(['"]\/['"]\)/, why: 'splits a path on "/", which finds no separator on Windows' },
  { pattern: /import\.meta\.url\.endsWith\(/, why: 'a basename match also fires for an unrelated script of the same name' },
];

const cliScripts = readdirSync(SCRIPTS_DIR)
  .filter(name => name.endsWith('.mjs') && !name.endsWith('.spec.mjs'))
  .map(name => ({ name, source: readFileSync(join(SCRIPTS_DIR, name), 'utf8') }));

/** Scripts that actually carry a main-module check; the rest are pure modules or pure commands. */
const guarded = cliScripts.filter(s => GUARD_LINE.test(s.source));

test('the scan sees the scripts it is meant to police', () => {
  // Non-vacuity: a refactor that renamed the directory or the extension would otherwise leave this
  // suite passing over an empty set, which is the same silent-pass failure it exists to prevent.
  assert.ok(cliScripts.length >= 8, `expected the CLI scripts to be found, saw ${cliScripts.length}`);
  assert.ok(guarded.length >= 4, `expected several self-invocation guards, saw ${guarded.length}`);
});

test('no script uses a self-invocation guard that can silently disable it', () => {
  const offenders = [];
  for (const { name, source } of guarded) {
    for (const { pattern, why } of BANNED) {
      if (pattern.test(source)) offenders.push(`${name}: ${why}`);
    }
  }
  assert.deepEqual(offenders, [], `banned self-invocation guard:\n${offenders.join('\n')}`);
});

test('every guarded script compares a real path against the decoded module URL', () => {
  const offenders = guarded.filter(s => !CORRECT_GUARD.test(s.source)).map(s => s.name);
  assert.deepEqual(offenders, [], `missing the real-path guard: ${offenders.join(', ')}`);
});

test('the correct guard holds for a path that needs URL escaping', () => {
  // The concrete case the audit gate silently failed on. Proven here rather than asserted: a URL
  // built by hand from this path does not equal import.meta.url, while the resolved comparison does.
  const spaced = '/tmp/openwa probe/check.mjs';
  const asUrl = new URL(`file://${encodeURI(spaced)}`).href;

  assert.notEqual(asUrl, `file://${spaced}`, 'the hand-built URL should differ once the path is escaped');
  assert.equal(resolve(fileURLToPath(asUrl)), spaced, 'the resolved comparison should still match');
});
