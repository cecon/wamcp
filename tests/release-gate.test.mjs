import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseAllowed } from '../scripts/release-gate.mjs';

function candidate() {
  return {
    repository: 'cecon/wamcp',
    mainSha: 'merged-commit',
    run: {
      name: 'Quality',
      path: '.github/workflows/ci.yml',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_repository: { full_name: 'cecon/wamcp' },
      head_sha: 'merged-commit',
    },
    jobs: ['quality', 'windows'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
    pulls: [
      {
        merged_at: '2026-10-02',
        merge_commit_sha: 'merged-commit',
        base: { ref: 'main', repo: { full_name: 'cecon/wamcp' } },
      },
    ],
  };
}

test('release accepts only the merged main commit after both CI jobs succeed', () => {
  assert.equal(releaseAllowed(candidate()), true);
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

test('release rejects PR CI, alternate workflows, forks, branches and unsuccessful runs', () => {
  for (const [key, value] of [
    ['event', 'pull_request'],
    ['path', '.github/workflows/other.yml'],
    ['head_branch', 'feature'],
    ['head_repository', { full_name: 'other/fork' }],
    ['conclusion', 'failure'],
    ['status', 'in_progress'],
  ]) {
    const c = candidate();
    c.run[key] = value;
    assert.equal(releaseAllowed(c), false);
  }
});
