import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseArtifacts } from '../scripts/release-artifacts.mjs';
test('Update manifest references the normalized signed installer and checksums match all artifacts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-release-'));
  try {
    const installer = 'WA MCP_26.10.3_x64-setup.exe';
    const signature = Buffer.from('untrusted comment: test fixture only\nnot-a-real-signature').toString(
      'base64',
    );
    writeFileSync(path.join(dir, installer), 'test installer bytes');
    assert.throws(() => releaseArtifacts(dir, '26.10.3'), /Missing updater signature/);
    writeFileSync(path.join(dir, `${installer}.sig`), signature);
    const manifest = releaseArtifacts(dir, '26.10.3');
    const target = manifest.platforms['windows-x86_64'];
    const filename = new URL(target.url).pathname.split('/').at(-1);
    assert.equal(filename, 'WA.MCP_26.10.3_x64-setup.exe');
    assert.ok(existsSync(path.join(dir, filename)));
    assert.equal(target.signature, readFileSync(path.join(dir, `${filename}.sig`), 'utf8'));
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8')).version, '26.10.3');
    for (const line of readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
      const [hash, file] = line.split('  ');
      assert.equal(
        createHash('sha256')
          .update(readFileSync(path.join(dir, file)))
          .digest('hex'),
        hash,
      );
    }
    assert.throws(() => releaseArtifacts(dir, '../bad'), /Invalid release version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
