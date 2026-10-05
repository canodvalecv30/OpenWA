/**
 * Pass the message's mimetype to the media download whatsapp-web.js runs in the page.
 *
 * `Message#downloadMedia()` decrypts through `WAWebDownloadManager.downloadAndMaybeDecrypt()`
 * without a `mimetype`. Current WhatsApp Web builds default the missing value to
 * `application/octet-stream` and check it against the media type, so every download of media the
 * page has not decrypted before fails with `InvalidMediaFileType`, which reaches Node as the
 * minified `t: t`. Media the page already decrypted comes from a cache keyed by file hash and skips
 * that check, which is why some downloads still succeed. Diagnosed upstream in whatsapp-web.js
 * issue #201908, with no release after 1.34.7; this adds the option that issue identifies.
 *
 * The source transform is deliberately exact and self-disabling. An unknown shape fails the
 * production image build instead of silently shipping without the fix, and the patch stands down
 * once the installed tree carries the line itself.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const MESSAGE_PATH = path.join('src', 'structures', 'Message.js');
// The two options of the downloadAndMaybeDecrypt call in downloadMedia the fix goes between,
// unique in the file.
const TYPE_LINE = '                        type: msg.type,\n';
const SIGNAL_LINE = '                        signal: new AbortController().signal,\n';
const ANCHOR = TYPE_LINE + SIGNAL_LINE;
const FIX = TYPE_LINE + '                        mimetype: msg.mimetype,\n' + SIGNAL_LINE;

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyBackport(wwjsDir = DEFAULT_WWJS) {
  const messageFile = path.join(wwjsDir, MESSAGE_PATH);
  if (!fs.existsSync(messageFile)) {
    throw new Error(`whatsapp-web.js Message.js not found at ${messageFile}`);
  }

  const source = fs.readFileSync(messageFile, 'utf8');
  const anchorCount = occurrences(source, ANCHOR);
  const fixCount = occurrences(source, FIX);

  if (anchorCount === 0 && fixCount === 1) {
    return {
      skipped: true,
      reason: 'installed whatsapp-web.js already passes the mimetype to the media download',
    };
  }
  if (anchorCount !== 1 || fixCount !== 0) {
    throw new Error(
      `unsupported Message.js shape (anchors: ${anchorCount}, fixes: ${fixCount}); ` +
        're-evaluate the media download backport against the installed whatsapp-web.js',
    );
  }

  fs.writeFileSync(messageFile, source.replace(ANCHOR, FIX));
  return { skipped: false, note: 'mimetype passed to the media download' };
}

/**
 * The stand-down branch above as a predicate, for the startup guard (engine-patch-status.ts).
 * Unreadable reads as applied: a tree we cannot inspect is not evidence of a broken one.
 */
function isApplied(wwjsDir = DEFAULT_WWJS) {
  try {
    const source = fs.readFileSync(path.join(wwjsDir, MESSAGE_PATH), 'utf8');
    return occurrences(source, ANCHOR) === 0 && occurrences(source, FIX) === 1;
  } catch {
    return true;
  }
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const result = applyBackport();
    console.log(`patch-wwebjs-download-mimetype: ${result.skipped ? `skipped: ${result.reason}` : result.note}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-download-mimetype: skipped: ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-download-mimetype: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = { applyBackport, isApplied, ANCHOR, FIX };
