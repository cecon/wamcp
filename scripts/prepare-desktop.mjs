import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

if (process.platform !== 'win32') throw new Error('O instalador atual é para Windows x64.');
const root = process.cwd(),
  runtime = path.join(root, 'src-tauri', 'runtime');
mkdirSync(runtime, { recursive: true });
copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
// Replace the server copy so files deleted or renamed in the repo do not linger in the runtime.
rmSync(path.join(runtime, 'server'), { recursive: true, force: true });
cpSync(path.join(root, 'server'), path.join(runtime, 'server'), { recursive: true });
const runtimeLock = path.join(runtime, 'package-lock.json');
const previousLock = existsSync(runtimeLock) ? readFileSync(runtimeLock, 'utf8') : null;
copyFileSync('package.json', path.join(runtime, 'package.json'));
copyFileSync('package-lock.json', runtimeLock);
// Reinstall whenever dependencies changed; a stale runtime makes the service exit silently on start.
const depsChanged = previousLock !== readFileSync('package-lock.json', 'utf8');
if (depsChanged || !existsSync(path.join(runtime, 'node_modules', '.package-lock.json')) || process.env.CI) {
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --ignore-scripts'], {
    cwd: runtime,
    stdio: 'inherit',
  });
}
// The backend serves the agent UI (/app) from runtime/web, in dev as well as in the installer.
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx vite build'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/copy-web.mjs'], { stdio: 'inherit' });
const binary = path.join(runtime, 'cloudflared.exe');
if (!existsSync(binary)) {
  const metadata = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest').then(
    (r) => {
      if (!r.ok) throw new Error('Falha ao consultar release cloudflared');
      return r.json();
    },
  );
  const asset = metadata.assets.find((a) => a.name === 'cloudflared-windows-amd64.exe');
  if (!asset?.digest?.startsWith('sha256:')) throw new Error('Release do cloudflared sem SHA256 verificável');
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error('Falha no download do cloudflared');
  const bytes = Buffer.from(await response.arrayBuffer());
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest)
    throw new Error('SHA256 inválido para cloudflared');
  writeFileSync(binary, bytes);
}
const svg = readFileSync('src/assets/icon.svg');
await sharp(svg).resize(32).png().toFile('src-tauri/icons/32x32.png');
await sharp(svg).resize(128).png().toFile('src-tauri/icons/128x128.png');
const png = await sharp(svg).resize(256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, png]));
console.log('Runtime, ícones e conector preparados. Nenhuma credencial foi incluída.');
