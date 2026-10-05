'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyBackport, isApplied, ANCHOR, FIX } = require('./patch-wwebjs-download-mimetype.js');

// The real shape around the anchor: the options object of the downloadAndMaybeDecrypt call.
const BEFORE = `                        mediaKeyTimestamp: msg.mediaKeyTimestamp,\n${ANCHOR}                        downloadQpl: mockQpl,\n`;
const AFTER = `                        mediaKeyTimestamp: msg.mediaKeyTimestamp,\n${FIX}                        downloadQpl: mockQpl,\n`;

function makeDependency(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-download-mimetype-'));
  const message = path.join(root, 'src', 'structures', 'Message.js');
  fs.mkdirSync(path.dirname(message), { recursive: true });
  fs.writeFileSync(message, source);
  return { root, message };
}

test('passes the mimetype to the media download', () => {
  const { root, message } = makeDependency(`head\n${BEFORE}tail\n`);

  const result = applyBackport(root);

  assert.deepEqual(result, { skipped: false, note: 'mimetype passed to the media download' });
  assert.equal(fs.readFileSync(message, 'utf8'), `head\n${AFTER}tail\n`);
});

test('is idempotent once the fix is present', () => {
  const { root, message } = makeDependency(`head\n${AFTER}tail\n`);
  const original = fs.readFileSync(message, 'utf8');

  assert.deepEqual(applyBackport(root), {
    skipped: true,
    reason: 'installed whatsapp-web.js already passes the mimetype to the media download',
  });
  assert.equal(fs.readFileSync(message, 'utf8'), original);
});

test('reports the patch as applied only once the transform has run', () => {
  const { root } = makeDependency(`head\n${BEFORE}tail\n`);

  assert.equal(isApplied(root), false);
  applyBackport(root);
  assert.equal(isApplied(root), true);
});

test('rejects an unknown dependency shape without changing it', () => {
  const { root, message } = makeDependency('class Message {}\n');
  const original = fs.readFileSync(message, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Message\.js shape/);
  assert.equal(fs.readFileSync(message, 'utf8'), original);
});

test('rejects an ambiguous dependency shape without changing it', () => {
  const { root, message } = makeDependency(`${BEFORE}${BEFORE}`);
  const original = fs.readFileSync(message, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Message\.js shape/);
  assert.equal(fs.readFileSync(message, 'utf8'), original);
});

// The patch stands down when the fix is already there, so a shape carrying both the fix and an
// unpatched call is not one it understands either.
test('rejects a fix present alongside an unpatched call', () => {
  const { root, message } = makeDependency(`${AFTER}${BEFORE}`);
  const original = fs.readFileSync(message, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Message\.js shape/);
  assert.equal(fs.readFileSync(message, 'utf8'), original);
  assert.equal(isApplied(root), false);
});
