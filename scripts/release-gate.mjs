import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseAllowed({ repository, sha, run, mainSha, pulls, jobs }) {
  const pr = pulls.find(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === sha &&
      pr.base.ref === 'main' &&
      pr.base.repo.full_name === repository,
  );
  if (!pr || sha !== mainSha) return false;
  if (
    run.name !== 'Quality' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'pull_request' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_repository?.full_name !== pr.head.repo.full_name ||
    run.head_sha !== pr.head.sha ||
    !run.pull_requests?.some((item) => item.number === pr.number)
  )
    return false;
  if (
    !['quality', 'windows'].every((name) =>
      jobs.some((job) => job.name === name && job.status === 'completed' && job.conclusion === 'success'),
    )
  )
    return false;
  return true;
}

export function checkRelease() {
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Release requires a merge into main');
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const api = (endpoint) =>
    JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }));
  const mainSha = api('branches/main').commit.sha;
  const pulls = api(`commits/${sha}/pulls?per_page=100`);
  const pr = pulls.find((pr) => pr.merged_at && pr.merge_commit_sha === sha && pr.base.ref === 'main');
  if (!pr || sha !== mainSha) return { publish: false };
  const runs = api(
    `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`,
  ).workflow_runs;
  const run = runs
    .filter((run) => run.pull_requests?.some((item) => item.number === pr.number))
    .sort((a, b) => b.id - a.id)[0];
  if (!run) return { publish: false };
  const jobs = api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs;
  if (!releaseAllowed({ repository, sha, run, mainSha, pulls, jobs })) {
    console.log('Release skipped: current main must be a PR merge with successful Quality CI.');
    return { publish: false };
  }
  const releases = api('releases?per_page=100');
  const existing = releases.find((release) => release.target_commitish === sha);
  if (existing?.draft) throw new Error('Incomplete draft release exists; inspect it before retrying.');
  return { publish: !existing, sha };
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
