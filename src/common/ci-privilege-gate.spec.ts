import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { executableLines } from './workflow-lines';

/**
 * The published image has no `USER` directive by design: docker-entrypoint.sh starts as root to fix
 * named-volume ownership and then drops via `exec gosu openwa`. That drop is the only thing keeping
 * an internet-facing Node process (and its Chromium subprocess) off uid 0, and
 * `scripts/smoke-test-non-root.sh` is the only check of it.
 *
 * The script existed but no workflow ran it — its sole appearance in ci.yml was inside a comment
 * explaining why shellcheck names it. A change that left the process as root therefore passed lint,
 * every test job, the multi-arch build, the boot smoke and the image scan, and was promoted to
 * `latest`. These pin that the script is INVOKED, because a mention is not a gate.
 */

const workflowDir = path.join(__dirname, '..', '..', '.github', 'workflows');

type Step = { name?: string; run?: string; uses?: string; with?: unknown };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

function workflowOf(file: string): Workflow {
  return yaml.load(fs.readFileSync(path.join(workflowDir, file), 'utf8')) as Workflow;
}

function runCommandsOf(file: string): string[] {
  return Object.values(workflowOf(file).jobs ?? {}).flatMap(job =>
    (job.steps ?? []).map(step => executableLines(step.run ?? '')),
  );
}

/**
 * Jobs that execute a repo-relative path, paired with whether the job ever checks the repo out.
 *
 * Both spellings count: `./scripts/x.sh` and the bare `scripts/x.sh` an interpreter is handed
 * (`bash scripts/x.sh`). Matching only the dotted form would leave the gate blind to the other way
 * of writing the very call it exists to protect.
 */
function jobsRunningRepoScripts(file: string): Array<{ job: string; scripts: string[]; hasCheckout: boolean }> {
  const REPO_PATH = /(?:^|[\s'"])(\.\/[\w./-]+|(?:scripts|bin|tools)\/[\w./-]+)/g;
  return Object.entries(workflowOf(file).jobs ?? {})
    .map(([job, def]) => {
      const steps = def.steps ?? [];
      const scripts = steps.flatMap(step => [...(step.run ?? '').matchAll(REPO_PATH)].map(m => m[1]));
      return { job, scripts, hasCheckout: steps.some(step => (step.uses ?? '').startsWith('actions/checkout')) };
    })
    .filter(entry => entry.scripts.length > 0);
}

describe('the non-root drop is enforced, not merely documented', () => {
  // A `run:` extractor that silently matched nothing would make every assertion below vacuously
  // pass. Anchor it on a script the workflows have always invoked.
  it('extracts run commands from the workflows', () => {
    expect(runCommandsOf('ci.yml').join('\n')).toContain('smoke-test-backup-restore.sh');
  });

  // The extractor's own defect, pinned: a mention is not an invocation. Disabling a step by commenting
  // it out is the exact shape that let the script go unrun while this file reported it enforced.
  it('does not count a commented-out invocation as running the script', () => {
    expect(executableLines('# ./scripts/smoke-test-non-root.sh\necho skipped')).not.toContain('smoke-test-non-root.sh');
    expect(executableLines('  OPENWA_SMOKE_IMAGE="$IMAGE" ./scripts/smoke-test-non-root.sh # run it')).toContain(
      'smoke-test-non-root.sh',
    );
    // A '#' inside a quoted string is data; truncating there would drop a real command.
    expect(executableLines('echo "tag #1" && ./scripts/smoke-test-non-root.sh')).toContain('smoke-test-non-root.sh');
  });

  // BOTH paths. The tag path is the one that promotes to `latest`, so a check present only on the PR
  // path leaves the publishing route unguarded — the asymmetry this workflow's own audit step forbids.
  it.each(['ci.yml', 'release.yml'])('invokes the non-root smoke test from %s', file => {
    const invocations = runCommandsOf(file).filter(run => run.includes('smoke-test-non-root.sh'));
    expect(invocations.length).toBeGreaterThan(0);
  });

  // The Dockerfile relies on the entrypoint's gosu drop rather than a USER directive. If that ever
  // changes to a real USER line the smoke test still passes, but this records WHY the directive is
  // absent, so its absence is never read as an oversight and "fixed" by deleting the drop.
  it('keeps the entrypoint gosu drop the image depends on', () => {
    const entrypoint = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-entrypoint.sh'), 'utf8');
    expect(entrypoint).toMatch(/exec\s+gosu\s+openwa/);
  });

  // The Dockerfile explains the missing USER directive by pointing at the entrypoint. A line number
  // goes stale on the next entrypoint edit and sends the reader to the wrong statement.
  it('does not cite entrypoint line numbers from the Dockerfile', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('docker-entrypoint.sh ends with');
    expect(dockerfile).not.toMatch(/docker-entrypoint\.sh:\d/);
    expect(dockerfile).not.toMatch(/chowns? on lines? \d/);
  });

  // Chromium's Singleton* locks, a relocated session profile and a backup staging copy are all
  // symlinks under /app/data. A bind mount that refuses to chown a symlink (Docker Desktop file
  // sharing) failed a recursive chown under `set -e` and crash-looped the container (#1722), and a
  // lock cleanup can only cover the default path. The ownership fix itself has to skip links.
  // `-h` too: find tests the type before the batched chown runs, so without it a path replaced by a
  // link in between would have root re-own the link's target.
  it('re-owns /app/data without touching symlinks', () => {
    const entrypoint = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-entrypoint.sh'), 'utf8');
    const cleanup = entrypoint.search(/^rm -f \/app\/data\/sessions\/\*\/Singleton\*/m);
    const chown = entrypoint.search(/^find \/app\/data ! -type l -exec chown -h openwa:openwa \{\} \+$/m);
    expect(entrypoint).not.toMatch(/^\s*chown\s+-R\b.*\/app\/data/m);
    // Swallowing the failure would hide a real refusal (NFS root_squash, SELinux).
    expect(entrypoint).not.toMatch(/-exec chown[^\n]*\|\|/);
    expect(cleanup).toBeGreaterThan(-1);
    expect(chown).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(chown);
  });
});

/**
 * Invoking the script is not the same as being able to run it. `boot-smoke` in release.yml called
 * `./scripts/smoke-test-non-root.sh` from a job that never checks the repo out — the file is simply
 * absent from the workspace, so the step exits 127 and the ONLY path that publishes `latest` fails
 * at every tag. Fail-closed, but the release path was broken rather than guarded.
 *
 * The gate above could not see it: it binds the text of `run:`, and the text was correct. This binds
 * the precondition instead, for every job in every workflow — a repo-relative command needs the repo.
 */
describe('a job that runs a repo script checks the repo out', () => {
  const workflows = fs.readdirSync(workflowDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  // Non-vacuity control: the finder must actually see jobs, or every assertion below passes on an
  // empty set. Anchor on a workflow known to run repo scripts.
  it('finds jobs that run repo-relative scripts', () => {
    expect(workflows.length).toBeGreaterThan(0);
    const all = workflows.flatMap(f => jobsRunningRepoScripts(f));
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(e => e.scripts.some(s => s.includes('scripts/')))).toBe(true);
  });

  it.each(workflows)('%s: every job running ./… also runs actions/checkout', file => {
    const offenders = jobsRunningRepoScripts(file)
      .filter(entry => !entry.hasCheckout)
      .map(entry => `${entry.job} runs ${entry.scripts.join(', ')} without actions/checkout`);
    expect(offenders).toEqual([]);
  });
});

/**
 * A job granted `id-token: write` can mint a registry publish credential, so every tool it installs
 * runs with that ability. A floating spec (`npm@latest`, a bare major) resolves to whatever was
 * published most recently at tag time; pin the exact version the way the Dockerfile pins its npm.
 *
 * Python installs cannot be pinned that way: `pip install` resolves the ranges in pyproject.toml, and
 * `python -m build` fetches its build backend into an isolated environment no pin reaches. The same
 * holds for pipx, uv, uvx, poetry and pyproject-build. So an id-token job runs none of them; the
 * install, test and build happen in a job without the grant.
 *
 * Only these two families are checked: other installers (npx, a local npm install, gem, go) in an
 * id-token job are not caught here.
 */
describe('a job that can mint a publish credential pins global npm installs and runs no Python installer', () => {
  type Permissions = Record<string, string> | string | null | undefined;
  type OidcJob = { permissions?: Permissions; steps?: Step[] };
  type OidcWorkflow = { permissions?: Permissions; jobs?: Record<string, OidcJob> };
  const workflows = fs.readdirSync(workflowDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  const GLOBAL_INSTALL = /\bnpm\s+(?:install|i|add)\s+(?:-g|--global)\s+([^\n;&|]+)/g;
  // `pip`, `pip3`, `python -m pip` and `uv pip` all contain `pip install`.
  const PYTHON_INSTALL =
    /\bpip[\d.]*\s+(?:install|wheel|download)\b|\bpython[\d.]*\s+-m\s+build\b|\bpyproject-build\b|\bpipx\s+(?:install|run)\b|\buvx\b|\buv\s+(?:sync|build|run|add|tool)\b|\bpoetry\s+(?:install|build|add)\b/g;

  // A job without its own `permissions` inherits the workflow-level block; `write-all` grants id-token too.
  const grantsIdToken = (perms: Permissions): boolean =>
    perms === 'write-all' || (typeof perms === 'object' && perms !== null && perms['id-token'] === 'write');

  const oidcJobRuns = (source: string | OidcWorkflow): Array<{ job: string; run: string }> => {
    const workflow =
      typeof source === 'string'
        ? (yaml.load(fs.readFileSync(path.join(workflowDir, source), 'utf8')) as OidcWorkflow)
        : source;
    return Object.entries(workflow.jobs ?? {})
      .filter(([, def]) => grantsIdToken(def.permissions !== undefined ? def.permissions : workflow.permissions))
      .flatMap(([job, def]) => (def.steps ?? []).map(step => ({ job, run: executableLines(step.run ?? '') })));
  };

  const globalInstallsInOidcJobs = (source: string | OidcWorkflow): Array<{ job: string; spec: string }> =>
    oidcJobRuns(source).flatMap(({ job, run }) =>
      [...run.matchAll(GLOBAL_INSTALL)].flatMap(match =>
        match[1]
          .trim()
          .split(/\s+/)
          .filter(arg => !arg.startsWith('-'))
          .map(spec => ({ job, spec })),
      ),
    );

  const pythonInstallsInOidcJobs = (source: string | OidcWorkflow): string[] =>
    oidcJobRuns(source).flatMap(({ job, run }) => [...run.matchAll(PYTHON_INSTALL)].map(m => `${job}: ${m[0]}`));

  // Non-vacuity: the JS SDK release job installs its own npm, so the finder must see it.
  it('finds the global npm install in the JS SDK publish job', () => {
    expect(globalInstallsInOidcJobs('js-sdk-release.yml').map(entry => entry.spec)).toEqual([
      expect.stringMatching(/^npm@/),
    ]);
  });

  it('treats a job that inherits id-token: write or write-all from the workflow as able to mint', () => {
    const job = { steps: [{ run: 'npm install -g npm@latest' }] };
    expect(globalInstallsInOidcJobs({ permissions: { 'id-token': 'write' }, jobs: { publish: job } })).toHaveLength(1);
    expect(globalInstallsInOidcJobs({ permissions: 'write-all', jobs: { publish: job } })).toHaveLength(1);
    expect(globalInstallsInOidcJobs({ jobs: { publish: { ...job, permissions: 'write-all' } } })).toHaveLength(1);
    // A job-level block replaces the workflow-level one, so it can also withdraw the grant.
    expect(
      globalInstallsInOidcJobs({ permissions: 'write-all', jobs: { publish: { ...job, permissions: {} } } }),
    ).toHaveLength(0);
  });

  it.each(workflows)('%s: global installs in id-token jobs are pinned to an exact version', file => {
    const floating = globalInstallsInOidcJobs(file).filter(entry => !/@\d+\.\d+\.\d+$/.test(entry.spec));
    expect(floating).toEqual([]);
  });

  // Non-vacuity: the single-job shape the PyPI release used to have, and the Python install that
  // still exists in the release workflow, just outside the id-token job.
  it('finds pip installs and python -m build in an id-token job', () => {
    const singleJob: OidcWorkflow = {
      jobs: {
        publish: {
          permissions: { contents: 'read', 'id-token': 'write' },
          steps: [
            { run: "pip install -e '.[dev]'\npytest" },
            { run: 'python -m pip install --upgrade build\npython -m build' },
          ],
        },
      },
    };
    expect(pythonInstallsInOidcJobs(singleJob)).toEqual([
      'publish: pip install',
      'publish: pip install',
      'publish: python -m build',
    ]);
    expect(runCommandsOf('python-sdk-release.yml').join('\n')).toMatch(PYTHON_INSTALL);
  });

  it('finds the other Python installers and build frontends in an id-token job', () => {
    const commands = [
      'pipx install twine',
      'pipx run build',
      'uvx twine upload dist/*',
      'uv sync',
      'uv build',
      'uv tool install twine',
      'poetry install',
      'poetry build',
      'pyproject-build',
      'python -m pip wheel .',
    ];
    const job: OidcWorkflow = {
      jobs: { publish: { permissions: { 'id-token': 'write' }, steps: commands.map(run => ({ run })) } },
    };
    expect(pythonInstallsInOidcJobs(job)).toHaveLength(commands.length);
  });

  it.each(workflows)('%s: id-token jobs run no Python installer or build frontend', file => {
    expect(pythonInstallsInOidcJobs(file)).toEqual([]);
  });
});
