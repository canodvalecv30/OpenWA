import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { executableLines } from './workflow-lines';

/**
 * The release workflow publishes the image and the GitHub Release from a tag push. A tag starts
 * release.yml ALONE (ci.yml triggers on branches), so whatever gate the tag path skips is a gate a
 * release never ran; the workflow's own header states the invariant ("a tag can never publish
 * something the branch gate would have refused"; "the release gate must not be laxer than the PR
 * gate"). Both sides drifted before: check:contract-shapes and test:docs ran only on branches, so
 * an SDK wire-shape regression or a repo-file drift could ride a tag to publication while the same
 * commit would have failed CI.
 *
 * This locks the invariant structurally: every gate command (npm/npx lines) in ci.yml's lint and
 * test jobs must also run in release.yml's lint and test jobs (the workflow header and the check:audit step comment both state
 * the invariant; this spec makes it enforced). The release jobs may run MORE
 * (its lint also carries the audit gate); only the subset direction is asserted.
 */

const workflowDir = path.join(__dirname, '..', '..', '.github', 'workflows');

type Step = { run?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const gateCommands = (file: string, job: string): string[] => {
  const workflow = yaml.load(fs.readFileSync(path.join(workflowDir, file), 'utf8')) as Workflow;
  const steps = workflow.jobs?.[job]?.steps ?? [];
  if (steps.length === 0) throw new Error(`${file} has no "${job}" job: the parity spec drifted`);
  return steps.flatMap(step =>
    executableLines(step.run ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^npx |^npm /.test(line)),
  );
};

describe('release gate parity (the tag path runs every branch gate)', () => {
  it.each(['lint', 'test', 'test-postgres'])('%s: every ci.yml gate command also runs in release.yml', job => {
    const ci = gateCommands('ci.yml', job);
    const release = gateCommands('release.yml', job);
    // Non-vacuity: both parsers must find real gate lanes, or the subset assertion below binds nothing.
    // The test lane legitimately has only 4-5 commands, so the floor is what the lane actually owns.
    expect(ci.length).toBeGreaterThanOrEqual(4);
    expect(release.length).toBeGreaterThanOrEqual(4);
    expect(ci.filter(command => !release.includes(command))).toEqual([]);
  });

  it('the two gates this spec was born from still run on the tag path', () => {
    expect(gateCommands('release.yml', 'lint')).toContain('npm run check:contract-shapes');
    expect(gateCommands('release.yml', 'test')).toContain('npm run test:docs');
    // The postgres lane names its specs inline, so a spec added to ci.yml alone would otherwise
    // leave the tag path running a strictly weaker suite than the branch it was cut from.
    expect(gateCommands('release.yml', 'test-postgres').join(' ')).toContain('message-list-ordering.pg.spec.ts');
  });
});

/**
 * A tag is a prerelease or it is not, and every release channel has to agree. The image channels
 * (X.Y, latest) and the promote job treat any tag with a '-' suffix as a prerelease; when the
 * GitHub Release matched only -rc/-beta/-alpha, a tag such as v1.2.0-next.1 stayed off `latest` on
 * the registries yet became GitHub's "Latest" release, which is what the in-app update check reads.
 */
describe('one prerelease rule across the GitHub Release and the image channels', () => {
  type ReleaseStep = { uses?: string; run?: string; with?: { prerelease?: string; tags?: string } };
  const PREDICATE = "contains(github.ref_name, '-')";
  const steps = (): ReleaseStep[] => {
    const workflow = yaml.load(fs.readFileSync(path.join(workflowDir, 'release.yml'), 'utf8')) as {
      jobs?: Record<string, { steps?: ReleaseStep[] }>;
    };
    return Object.values(workflow.jobs ?? {}).flatMap(job => job.steps ?? []);
  };

  it('flags the GitHub Release prerelease by the predicate that keeps a tag off X.Y and latest', () => {
    const ghRelease = steps().filter(step => (step.uses ?? '').startsWith('softprops/action-gh-release'));
    expect(ghRelease).toHaveLength(1);
    expect((ghRelease[0].with?.prerelease ?? '').trim()).toBe(`\${{ ${PREDICATE} }}`);

    const tagRules = steps()
      .filter(step => (step.uses ?? '').startsWith('docker/metadata-action'))
      .map(step => step.with?.tags ?? '')
      .join('\n');
    const enables = [...tagRules.matchAll(/enable=\$\{\{\s*(.*?)\s*\}\}/g)].map(match => match[1]);
    // Non-vacuity: the X.Y and latest channels are both gated.
    expect(enables.length).toBeGreaterThanOrEqual(2);
    expect(enables.filter(expr => expr !== `!${PREDICATE}`)).toEqual([]);

    // The promote job's own skip for minor tags uses the same '-' test in bash.
    expect(steps().some(step => /\[\[ "\$REF_NAME" == \*-\* \]\]/.test(step.run ?? ''))).toBe(true);
  });
});
