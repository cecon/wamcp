import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const roots = [
  'src',
  'scripts',
  'tests',
  'src-tauri/src',
  'src-tauri/server/src',
  'src-tauri/server/tests',
].filter(existsSync);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
// Hexagonal layers of the Rust backend: the domain depends on nothing, the application only on the domain.
const layers = {
  'src-tauri/server/src/domain/': ['domain'],
  'src-tauri/server/src/application/': ['domain', 'application'],
};
let failures = 0;
for (const file of roots.flatMap(files)) {
  if (!/\.(mjs|tsx?|rs|css)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  const count = source.trimEnd().split('\n').length;
  if (count > 300) {
    console.error(`${file}: ${count} linhas (limite: 300)`);
    failures++;
  }
  const normalized = file.replaceAll('\\', '/');
  const allowed = Object.entries(layers).find(([prefix]) => normalized.startsWith(prefix))?.[1];
  if (!allowed) continue;
  for (const [, layer] of source.matchAll(/crate::(\w+)/g)) {
    if (!allowed.includes(layer)) {
      console.error(`${file}: camada não pode depender de crate::${layer}`);
      failures++;
    }
  }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const crate = (manifest) => readFileSync(manifest, 'utf8').match(/^version = "([^"]+)"/m)?.[1];
const crates = ['src-tauri/Cargo.toml', 'src-tauri/server/Cargo.toml'].map(crate);
if (pkg.version !== tauri.version || crates.some((version) => version !== pkg.version)) {
  console.error('Versões divergentes');
  failures++;
}
if (failures) process.exit(1);
console.log('Arquitetura, versão e limite de 300 linhas verificados.');
