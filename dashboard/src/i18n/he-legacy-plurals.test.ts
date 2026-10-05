import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import i18next from 'i18next';

// Before CLDR 42 Hebrew had a `many` plural category (20, 30, 40, ...). Safari takes its plural data
// from the operating system, so Safari 16.4 and 17 on macOS 12 still select it, and those are inside
// the build's browser target. i18next falls back from a missing `_many` to the bare key, which is the
// Hebrew singular, so every plural key needs a `_many` form even though current runtimes never ask.

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(HERE, 'locales', file), 'utf8')) as Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = '', out = new Map<string, unknown>()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out.set(path, value);
  }
  return out;
}

class PreCldr42PluralRules extends Intl.PluralRules {
  select(n: number): Intl.LDMLPluralRule {
    return Number.isInteger(n) && n > 10 && n % 10 === 0 ? 'many' : super.select(n);
  }
  resolvedOptions(): Intl.ResolvedPluralRulesOptions {
    const options = super.resolvedOptions();
    return { ...options, pluralCategories: [...new Set([...options.pluralCategories, 'many' as const])] };
  }
}

test('Hebrew renders the plural form for 20 under the pre-CLDR-42 plural rules', async () => {
  const pluralBases = [...flatten(load('en.json')).keys()]
    .filter(key => key.endsWith('_other'))
    .map(key => key.slice(0, -'_other'.length));
  const he = flatten(load('he.json'));

  const intl = Intl as { PluralRules: typeof Intl.PluralRules };
  const native = intl.PluralRules;
  // A class cannot be called without `new`; i18next only ever constructs it.
  intl.PluralRules = PreCldr42PluralRules as typeof Intl.PluralRules;
  try {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'he', resources: { he: { translation: load('he.json') } }, initAsync: false });
    for (const base of pluralBases) {
      const expected = String(he.get(`${base}_other`)).replace('{{count}}', '20');
      assert.equal(i18n.t(base, { count: 20 }), expected, base);
    }
  } finally {
    intl.PluralRules = native;
  }
});
