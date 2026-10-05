import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// index.css gives html[lang='he'] and html[lang='ar'] their own font stack. A font-family declared on
// body or #root beats the value those would inherit, so the Hebrew and Arabic fonts the entry point
// bundles would never render and those scripts would fall back to a system font.

const SRC = dirname(fileURLToPath(import.meta.url));
const cssFiles = (readdirSync(SRC, { recursive: true }) as string[]).filter(f => f.endsWith('.css'));

// The `font` shorthand resets font-family too; the colon keeps font-weight and font-size out.
const SETS_FONT_FAMILY = /(^|;|\s)font(-family)?\s*:/;

test('the font-family pattern catches the font shorthand but not other font properties', () => {
  for (const body of [' font-family: X;', " font: 16px/1.6 'X', sans-serif;", 'font:inherit']) {
    assert.match(body, SETS_FONT_FAMILY);
  }
  for (const body of [' font-weight: 500;', ' font-size: 1rem;', ' -webkit-font-smoothing: antialiased;']) {
    assert.doesNotMatch(body, SETS_FONT_FAMILY);
  }
});

test('no stylesheet sets a font-family or font shorthand on body or #root', () => {
  for (const file of cssFiles) {
    const css = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = selectorList.split(',').map(s => s.trim());
      if (!selectors.some(s => s === 'body' || s === '#root')) continue;
      assert.doesNotMatch(
        body,
        SETS_FONT_FAMILY,
        `${file}: ${selectorList.trim()} sets a font-family or font shorthand`,
      );
    }
  }
});
