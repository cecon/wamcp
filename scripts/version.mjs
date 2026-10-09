import { readFileSync, writeFileSync } from 'node:fs';
const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'];
const pkg = JSON.parse(readFileSync(files[0], 'utf8'));
let version = process.argv[2];
if (version === 'next') {
  const now = new Date();
  const prefix = `${String(now.getUTCFullYear()).slice(-2)}.${now.getUTCMonth() + 1}.`;
  version = prefix + (pkg.version.startsWith(prefix) ? Number(pkg.version.split('.')[2]) + 1 : 1);
}
if (!/^\d{2}\.(?:[1-9]|1[0-2])\.[1-9]\d*$/.test(version || ''))
  throw new Error('Use YY.M.incremental (meses 1–9 sem zero por compatibilidade SemVer).');
for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
// The desktop crate and the embedded backend crate share the release version.
for (const manifest of ['src-tauri/Cargo.toml', 'src-tauri/server/Cargo.toml']) {
  const cargo = readFileSync(manifest, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`);
  writeFileSync(manifest, cargo);
}
const lock = readFileSync('src-tauri/Cargo.lock', 'utf8').replace(
  /(name = "(?:wamcp|wamcp-server)"\r?\nversion = ")[^"]+("[\r\n])/g,
  `$1${version}$2`,
);
writeFileSync('src-tauri/Cargo.lock', lock);
console.log(`Versão sincronizada: ${version}`);
