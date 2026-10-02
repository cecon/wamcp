import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseAllowed } from '../scripts/release-gate.mjs';
import { nextReleaseVersion } from '../scripts/release-version.mjs';

function candidate() {
  return {
    repository: 'cecon/wamcp',
    mainSha: 'merged-commit',
    sha: 'merged-commit',
    run: {
      name: 'Quality',
      path: '.github/workflows/ci.yml',
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'feature',
      head_repository: { full_name: 'cecon/wamcp' },
      head_sha: 'tested-head',
      pull_requests: [{ number: 10 }],
    },
    jobs: ['quality', 'windows'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
    pulls: [
      {
        merged_at: '2026-10-02',
        number: 10,
        merge_commit_sha: 'merged-commit',
        head: { sha: 'tested-head', ref: 'feature', repo: { full_name: 'cecon/wamcp' } },
        base: { ref: 'main', repo: { full_name: 'cecon/wamcp' } },
      },
    ],
  };
}

test('release accepts only the merged main commit after both CI jobs succeed', () => {
  assert.equal(releaseAllowed(candidate()), true);
  const deletedBranch = candidate();
  deletedBranch.run.pull_requests = [];
  assert.equal(releaseAllowed(deletedBranch), true);
});

test('release rejects direct pushes, unmerged PRs, another base and stale commits', () => {
  for (const mutate of [
    (c) => {
      c.pulls = [];
    },
    (c) => {
      c.pulls[0].merged_at = null;
    },
    (c) => {
      c.pulls[0].merge_commit_sha = 'other';
    },
    (c) => {
      c.pulls[0].base.ref = 'develop';
    },
    (c) => {
      c.mainSha = 'newer-commit';
    },
  ]) {
    const c = candidate();
    mutate(c);
    assert.equal(releaseAllowed(c), false);
  }
});

test('release rejects failed, cancelled, skipped, pending or missing required jobs', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', null]) {
    const c = candidate();
    c.jobs[1].conclusion = conclusion;
    assert.equal(releaseAllowed(c), false);
  }
  const c = candidate();
  c.jobs.pop();
  assert.equal(releaseAllowed(c), false);
  const pending = candidate();
  pending.jobs[0].status = 'in_progress';
  assert.equal(releaseAllowed(pending), false);
});

test('release rejects unrelated CI, alternate workflows and unsuccessful runs', () => {
  for (const [key, value] of [
    ['event', 'push'],
    ['path', '.github/workflows/other.yml'],
    ['head_sha', 'untested-head'],
    ['head_branch', 'unrelated'],
    ['pull_requests', [{ number: 99 }]],
    ['head_repository', { full_name: 'other/fork' }],
    ['conclusion', 'failure'],
    ['status', 'in_progress'],
  ]) {
    const c = candidate();
    c.run[key] = value;
    assert.equal(releaseAllowed(c), false);
  }
});

test('automatic bump uses the highest reserved or released version and resets each UTC month', () => {
  const now = new Date('2026-10-02T03:00:00Z');
  assert.equal(nextReleaseVersion(['26.10.7', 'v26.10.6'], now), '26.10.8');
  assert.equal(nextReleaseVersion(['26.10.7', 'v26.10.12', 'v26.10.9'], now), '26.10.13');
  assert.equal(nextReleaseVersion(['v26.9.99', 'invalid', 'v26.10.bad'], now), '26.10.1');
  assert.equal(nextReleaseVersion(['26.12.99'], new Date('2027-01-01T00:00:00Z')), '27.1.1');
});
