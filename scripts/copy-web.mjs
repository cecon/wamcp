import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

// The Node runtime serves the agent web app (/app) from runtime/web; Tauri bundles runtime/ as a resource.
const dist = path.resolve('dist'),
  target = path.resolve('src-tauri', 'runtime', 'web');
if (!existsSync(path.join(dist, 'agent.html')))
  throw new Error('Execute npm run build antes de copiar a interface web.');
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
console.log('Interface web dos agentes copiada para o runtime.');
