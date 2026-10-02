import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function nextReleaseVersion(versions, now = new Date()) {
  const prefix = `${String(now.getUTCFullYear()).slice(-2)}.${now.getUTCMonth() + 1}.`;
  const increments = versions
    .map((value) => String(value).replace(/^v/, ''))
    .filter((value) => value.startsWith(prefix) && /^\d{2}\.\d{1,2}\.[1-9]\d*$/.test(value))
    .map((value) => Number(value.split('.')[2]));
  return prefix + (Math.max(0, ...increments) + 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY;
  const pages = JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repository}/tags?per_page=100`], {
      encoding: 'utf8',
    }),
  );
  const base = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const version = nextReleaseVersion([base, ...pages.flat().map((tag) => tag.name)]);
  execFileSync(process.execPath, ['scripts/version.mjs', version], { stdio: 'inherit' });
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
}
