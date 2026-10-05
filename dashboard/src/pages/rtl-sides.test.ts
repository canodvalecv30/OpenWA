import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// i18n/index.ts sets <html dir="rtl"> for Hebrew and Arabic. A physical left or right side in a
// margin, padding, border, corner radius or text alignment stays put when the layout mirrors, so a
// divider or accent bar lands on the wrong edge and a header detaches from its column.
const PHYSICAL_SIDE =
  /(?:margin|padding|border)-(?:left|right)\b|border-(?:top|bottom)-(?:left|right)-radius|text-align:\s*(?:left|right)/;

function physicalSides(file: string): string[] {
  const css = readFileSync(new URL(file, import.meta.url), 'utf8')
    // Blank out comments but keep their line breaks, so a reported line number matches the file.
    .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ''));
  return css
    .split('\n')
    .map((line, i) => `${file}:${i + 1}: ${line.trim()}`)
    .filter(line => PHYSICAL_SIDE.test(line));
}

test('the API keys stylesheet uses logical sides only', () => {
  assert.deepEqual(physicalSides('./ApiKeys.css'), []);
});

test('the chats stylesheet uses logical sides only', () => {
  assert.deepEqual(physicalSides('./Chats.css'), []);
});
