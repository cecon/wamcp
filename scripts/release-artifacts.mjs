import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import metadata from '../package.json' with { type: 'json' };
export function releaseArtifacts(dir, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const installers = readdirSync(dir).filter((name) => name.endsWith('.exe'));
  if (installers.length !== 1) throw new Error('Expected one Windows installer');
  const original = installers[0],
    name = original.replaceAll(' ', '.');
  const signaturePath = path.join(dir, `${original}.sig`);
  if (!existsSync(signaturePath)) throw new Error('Missing updater signature');
  const signature = readFileSync(signaturePath, 'utf8').trim();
  if (!signature || !Buffer.from(signature, 'base64').toString('utf8').startsWith('untrusted comment:'))
    throw new Error('Invalid updater signature format');
  if (original !== name) {
    renameSync(path.join(dir, original), path.join(dir, name));
    renameSync(signaturePath, path.join(dir, `${name}.sig`));
  }
  const manifest = {
    version,
    notes: `WA MCP ${version}: melhorias e correções.`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://github.com/cecon/wamcp/releases/download/v${version}/${encodeURIComponent(name)}`,
      },
    },
  };
  writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const checksums = [name, `${name}.sig`, 'latest.json']
    .map(
      (file) =>
        `${createHash('sha256')
          .update(readFileSync(path.join(dir, file)))
          .digest('hex')}  ${file}`,
    )
    .join('\n');
  writeFileSync(path.join(dir, 'SHA256SUMS.txt'), checksums + '\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  releaseArtifacts('src-tauri/target/release/bundle/nsis', metadata.version);
  console.log('Instalador, assinatura, feed de atualização e checksums preparados.');
}
