import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

/**
 * GHCR deletes by version, and after a successful promote the release tags share the staging tag's
 * version. The cleanup job decides from a read of the package-versions API, which is eventually
 * consistent: a read that does not list the new release tags yet shows the staging tag alone, and
 * deleting that version unpublishes X.Y.Z, X.Y and latest together. A promote that failed partway
 * may already have attached release tags too, and the same read cannot be trusted there. So the
 * delete step runs only when promote never ran, whatever the read says.
 */
describe('release staging-tag cleanup', () => {
  type Step = { if?: string; run?: string };
  type Job = { if?: string; needs?: string[]; steps?: Step[] };
  const workflow = yaml.load(
    readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8'),
  ) as { jobs?: Record<string, Job> };
  const job = workflow.jobs?.['cleanup-staging'];

  it('still runs on the failure path, after promote', () => {
    expect(job?.if).toBe('always()');
    expect(job?.needs).toContain('promote');
  });

  it('skips every delete once promote ran at all', () => {
    const deleting = (job?.steps ?? []).filter(step => /-X DELETE/.test(step.run ?? ''));
    // Vacuity guard: a renamed job or a reworded command would leave nothing to check.
    expect(deleting.length).toBeGreaterThan(0);
    for (const step of deleting) expect(step.if).toBe("needs.promote.result == 'skipped'");
  });
});
