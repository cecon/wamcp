// Progresso da migração para o C3Theme: classifica as telas e componentes de `src/agent` em três grupos —
// **migrada** (importa MUI/C3Theme), **pendente** (desenha com `className` e ainda não usa o pacote) e **fora**
// (arquivo sem UI, ex.: hook ou tipos). Gera `docs/c3theme/progresso.md`; `--check` recusa o arquivo desatualizado.
//
//   node scripts/c3-progresso.mjs [--check]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARQUIVO = 'docs/c3theme/progresso.md';

/** Arquivos que não são tela (bootstrap, spike e o próprio tema do C3Theme). */
const FORA = ['main.tsx', 'Entry.tsx', 'c3/', 'shell/', 'styles/', 'api.ts', 'types.ts'];

const IMPORTA_PACOTE = /from '@(?:mui|emotion)\/|from '@c3theme\//;
const TEM_CLASSNAME = /className=/;

/** `migrada`, `pendente` ou `fora` (arquivo sem interface). */
export function classifica(texto) {
  if (IMPORTA_PACOTE.test(texto)) return 'migrada';
  if (TEM_CLASSNAME.test(texto)) return 'pendente';
  return 'fora';
}

function* arquivos(pasta) {
  const nomes = readdirSync(pasta).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  for (const nome of nomes) {
    const completo = path.join(pasta, nome);
    if (statSync(completo).isDirectory()) yield* arquivos(completo);
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) yield completo;
  }
}

/** Telas por pasta: `{ pasta, total, migradas, pendentes }`, sem os arquivos fora de escopo. */
export function levantar(raiz = RAIZ) {
  const base = path.join(raiz, 'src', 'agent');
  const porPasta = new Map();
  for (const arquivo of arquivos(base)) {
    const rel = path.relative(base, arquivo).replaceAll('\\', '/');
    if (FORA.some((f) => rel === f || rel.startsWith(f))) continue;
    const estado = classifica(readFileSync(arquivo, 'utf8'));
    if (estado === 'fora') continue;
    const partes = rel.split('/');
    const pasta = partes.length > 1 ? partes[0] : '(raiz)';
    const item = porPasta.get(pasta) ?? { pasta, total: 0, migradas: 0, pendentes: [] };
    item.total += 1;
    if (estado === 'migrada') item.migradas += 1;
    else item.pendentes.push(rel);
    porPasta.set(pasta, item);
  }
  return [...porPasta.values()].sort((a, b) => a.pasta.localeCompare(b.pasta));
}

/** O markdown do progresso. */
export function relatorio(pastas) {
  const total = pastas.reduce((soma, p) => soma + p.total, 0);
  const migradas = pastas.reduce((soma, p) => soma + p.migradas, 0);
  const pendentes = total - migradas;
  const pct = total ? Math.round((migradas / total) * 100) : 100;
  return [
    '# Progresso da migração para o C3Theme',
    '',
    'Gerado por `node scripts/c3-progresso.mjs` (o `--check` recusa este arquivo desatualizado). Uma tela conta como',
    '**migrada** quando importa MUI/`@c3theme/*`; conta como **pendente** quando ainda desenha com `className` e não',
    'usa o pacote. Arquivos sem interface (hooks, tipos) ficam fora. Spike, shell do C3Theme e bootstrap também.',
    '',
    `**${migradas} de ${total} telas migradas (${pct}%)** · faltam ${pendentes}`,
    '',
    '| Pasta | Migradas | Faltam |',
    '|---|---:|---:|',
    ...pastas.map((p) => `| ${p.pasta} | ${p.migradas} / ${p.total} | ${p.pendentes.length} |`),
    '',
    '## O que falta, por pasta',
    '',
    ...pastas
      .filter((p) => p.pendentes.length)
      .flatMap((p) => [`### ${p.pasta}`, '', ...p.pendentes.map((arquivo) => `- \`${arquivo}\``), '']),
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const atual = relatorio(levantar());
  if (process.argv.includes('--check')) {
    const salvo = readFileSync(path.join(RAIZ, ARQUIVO), 'utf8');
    if (salvo !== atual) {
      console.error('Progresso desatualizado: rode node scripts/c3-progresso.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(path.join(RAIZ, ARQUIVO), atual);
    console.log(`Progresso gravado em ${ARQUIVO}`);
  }
}
