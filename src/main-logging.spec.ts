import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * main.ts boots on import, so its banner and advisories cannot be exercised by a unit test; lock the
 * source instead, the way load-env.spec.ts locks its import order. A raw console line bypasses
 * LOG_LEVEL and, in production, lands as plain text in an otherwise JSON log stream.
 */
describe('bootstrap logging', () => {
  it.each(['main.ts', 'configure-app.ts'])('%s writes through the structured logger, not console', file => {
    const source = readFileSync(resolve(__dirname, file), 'utf8');

    expect(source).not.toMatch(/\bconsole\.\w+\(/);
  });
});

describe('API_KEY_PEPPER advisory', () => {
  // A pepper set on an install with keys locks every key out, the admin key included, so the advisory
  // must not tell the operator to enable it and then re-issue keys through the API.
  it('names the lockout and the recovery instead of a re-issue', () => {
    const source = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');

    expect(source).not.toMatch(/re-issue keys|re-hashes keys/);
    expect(source).toContain('before the first boot');
    expect(source).toContain('until the previous pepper is restored');
  });
});
