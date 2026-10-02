import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseAllowed({ repository, run, mainSha, pulls, jobs }) {
  if (
    run.name !== 'Quality' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== mainSha
  )
    return false;
  if (
    !['quality', 'windows'].every((name) =>
      jobs.some((job) => job.name === name && job.status === 'completed' && job.conclusion === 'success'),
    )
  )
    return false;
  return pulls.some(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === run.head_sha &&
      pr.base.ref === 'main' &&
      pr.base.repo.full_name === repository,
  );
}

export function checkRelease() {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_run') throw new Error('Release requires workflow_run');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = process.env.GITHUB_REPOSITORY;
  const api = (endpoint) =>
    JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }));
  const run = api(`actions/runs/${event.workflow_run.id}`);
  const mainSha = api('branches/main').commit.sha;
  const pulls = api(`commits/${run.head_sha}/pulls?per_page=100`);
  const jobs = api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs;
  if (!releaseAllowed({ repository, run, mainSha, pulls, jobs })) {
    console.log('Release skipped: current main must be a PR merge with successful Quality CI.');
    return { publish: false };
  }
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  if (!/^\d{2}\.(?:[1-9]|1[0-2])\.[1-9]\d*$/.test(version)) throw new Error('Invalid release version');
  const tag = `v${version}`;
  const refs = api(`git/matching-refs/tags/${tag}`).filter((ref) => ref.ref === `refs/tags/${tag}`);
  if (refs.some((ref) => ref.object.type !== 'commit' || ref.object.sha !== run.head_sha))
    throw new Error('Release tag belongs to a different commit; bump the version in a PR.');
  const releases = api('releases?per_page=100');
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing?.draft) throw new Error('Incomplete draft release exists; inspect it before retrying.');
  return { publish: !existing, sha: run.head_sha, tag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRelease();
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(result)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  console.log(result);
}
