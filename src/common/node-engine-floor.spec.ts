import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `engines.node` is the only minimum a from-source install is told about, so it must not sit below
 * the floor of a package the lockfile installs: on such a Node, `npm ci` warns (or fails under
 * engine-strict) and the dependency may use an API the runtime lacks. Each package range is checked
 * against the declared floor itself, so a `||` range that skips the declared major (`^20 || >=24`
 * under `>=22`) is caught too. Optional platform binaries are skipped, as npm skips them.
 */
describe('package.json engines.node covers every installed package floor', () => {
  const repo = join(__dirname, '..', '..');
  const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(repo, file), 'utf8')) as T;
  // Hoisted by the lockfile (bullmq, sharp and ts-jest depend on it); it ships no types of its own.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const semver = require('semver') as {
    minVersion(range: string): { version: string } | null;
    satisfies(version: string, range: string): boolean;
  };

  const unmetFloors = (declared: string, packages: Record<string, { optional?: boolean; engines?: unknown }>) => {
    const own = /^\s*>=\s*v?\d+(?:\.\d+){0,2}\s*$/.test(declared) ? semver.minVersion(declared) : null;
    if (!own) throw new Error(`engines.node must be a plain >= floor, got "${declared}"`);
    const unmet: string[] = [];
    for (const [path, meta] of Object.entries(packages)) {
      if (!path || meta.optional) continue;
      const range = (meta.engines as { node?: string } | undefined)?.node;
      if (typeof range === 'string' && !semver.satisfies(own.version, range)) {
        unmet.push(`${path.replace(/^.*node_modules\//, '')} ${range}`);
      }
    }
    return unmet.sort();
  };

  it('is not below any non-optional package in package-lock.json', () => {
    const pkg = readJson<{ engines: { node: string } }>('package.json');
    const lock = readJson<{ packages: Record<string, { optional?: boolean; engines?: unknown }> }>('package-lock.json');

    // Guard the scan: a lockfile read that found no floors would pass vacuously.
    const floors = Object.values(lock.packages).filter(
      meta => typeof (meta.engines as { node?: unknown } | undefined)?.node === 'string',
    );
    expect(floors.length).toBeGreaterThan(50);
    expect(lock.packages[''].engines).toEqual(pkg.engines);

    expect(unmetFloors(pkg.engines.node, lock.packages)).toEqual([]);
  });

  it('names a package whose floor is above the declared one', () => {
    const packages = {
      '': {},
      'node_modules/high': { engines: { node: '>=22.19.0' } },
      'node_modules/multi': { engines: { node: '^20.19.0 || >=24' } },
      'node_modules/covered': { engines: { node: '^20.19.0 || >=22.12.0' } },
      'node_modules/any': { engines: { node: '*' } },
      'node_modules/bin': { optional: true, engines: { node: '>=99' } },
    };
    expect(unmetFloors('>=22.13', packages)).toEqual(['high >=22.19.0', 'multi ^20.19.0 || >=24']);
    expect(unmetFloors('>=22.19', packages)).toEqual(['multi ^20.19.0 || >=24']);
    expect(unmetFloors('>=24', packages)).toEqual([]);
  });
});
