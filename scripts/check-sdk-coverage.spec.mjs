import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinPythonLiterals, undeclaredVerbPairs } from './check-sdk-coverage.mjs';

const specByPath = new Map([
  ['/api/sessions/*/groups/*', { get: {} }],
  ['/api/sessions/*/webhooks/*', { put: {}, delete: {} }],
]);

test('undeclaredVerbPairs flags a verb the contract does not declare on a single-verb path', () => {
  assert.deepEqual(undeclaredVerbPairs('python', new Set(['POST /api/sessions/*/groups/*']), specByPath), [
    'POST /api/sessions/*/groups/*: built by python, not declared by the contract',
  ]);
  assert.deepEqual(undeclaredVerbPairs('python', new Set(['GET /api/sessions/*/groups/*']), specByPath), []);
});

test('undeclaredVerbPairs flags a wrong verb on a multi-verb path', () => {
  const pairs = new Set(['PUT /api/sessions/*/webhooks/*', 'PATCH /api/sessions/*/webhooks/*']);
  assert.deepEqual(undeclaredVerbPairs('go', pairs, specByPath), [
    'PATCH /api/sessions/*/webhooks/*: built by go, not declared by the contract',
  ]);
});

test('undeclaredVerbPairs ignores a pair that is not a contract path', () => {
  assert.deepEqual(undeclaredVerbPairs('javascript', new Set(['POST /api/sessions/*/messages/*']), specByPath), []);
});

test('joinPythonLiterals joins a path split across adjacent literals', () => {
  const expr = 'f"/api/sessions/{a}/groups/{b}"\n            "/membership-requests/approve"';
  assert.equal(joinPythonLiterals(expr), '/api/sessions/{a}/groups/{b}/membership-requests/approve');
});

test('a run through a symlinked path still reports', () => {
  // Node realpaths the main module's URL but not argv[1], so a guard comparing the unresolved path
  // skipped every check and exited 0 whenever the invocation crossed a symlink (/tmp on macOS).
  const dir = mkdtempSync(join(tmpdir(), 'sdk-coverage-'));
  try {
    symlinkSync(fileURLToPath(new URL('..', import.meta.url)), join(dir, 'repo'));
    const run = spawnSync(process.execPath, [join(dir, 'repo', 'scripts', 'check-sdk-coverage.mjs')], {
      encoding: 'utf8',
    });
    assert.match(run.stdout + run.stderr, /SDK contract coverage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
