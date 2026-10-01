import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const roots = ['src', 'server', 'scripts', 'tests', 'src-tauri/src'];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
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
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const dependency = match[1];
    if (normalized.startsWith('server/domain/') && !dependency.startsWith('./')) {
      console.error(`${file}: domínio não pode importar ${dependency}`);
      failures++;
    }
    if (
      normalized.startsWith('server/application/') &&
      !dependency.startsWith('./') &&
      !dependency.startsWith('../domain/')
    ) {
      console.error(`${file}: aplicação não pode importar ${dependency}`);
      failures++;
    }
  }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (pkg.version !== tauri.version || pkg.version !== cargo) {
  console.error('Versões divergentes');
  failures++;
}
if (failures) process.exit(1);
console.log('Arquitetura, versão e limite de 300 linhas verificados.');
