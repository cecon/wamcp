// Servidor de referência do plugin Contador: guarda clientes, documentos e prazos do escritório
// num arquivo JSON e responde às ferramentas do plugin. Sem dependências: `node server.mjs`.
//
//   CONTADOR_TOKEN   obrigatório; o mesmo valor vai na credencial "token" do plugin
//   CONTADOR_PORT    porta (padrão 8790), sempre em 127.0.0.1
//   CONTADOR_DADOS   arquivo de dados (padrão ./dados.json, criado a partir de dados.exemplo.json)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digits, load as loadFile, serve } from '../lib/servidor.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, 'dados.exemplo.json');

export const load = (file) => loadFile(file, example);
const month = (today) => today.toISOString().slice(0, 7);

/** The next date (YYYY-MM-DD) the day-of-month `day` comes, from `today` on. */
export function nextDate(day, today) {
  const year = today.getUTCFullYear(),
    m = today.getUTCMonth();
  const candidate = new Date(Date.UTC(year, m, day));
  const date =
    candidate >= new Date(Date.UTC(year, m, today.getUTCDate()))
      ? candidate
      : new Date(Date.UTC(year, m + 1, day));
  return date.toISOString().slice(0, 10);
}

function upcoming(data, today, days, regime) {
  const limit = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
  return data.prazos
    .filter((p) => !regime || p.regime === 'todos' || p.regime === regime)
    .map((p) => ({ obrigacao: p.obrigacao, regime: p.regime, vence: nextDate(p.dia, today) }))
    .filter((p) => p.vence <= limit)
    .sort((a, b) => a.vence.localeCompare(b.vence));
}

/** The client the call is about: the conversation's contact, else `telefone` (internal routines). */
function client(data, args) {
  const phone = digits(args.contato?.telefone || args.telefone);
  const found = data.clientes.find((c) => digits(c.telefone) === phone);
  if (!found) throw new Error('Cliente não encontrado no escritório');
  return found;
}

/** Each tool: (data, args, today) → answer; `changed` marks a write. */
export const tools = {
  situacao(data, args, today) {
    const c = client(data, args);
    const faltando = c.documentos.filter((d) => !d.recebido).map((d) => ({ mes: d.mes, tipo: d.tipo }));
    return {
      nome: c.nome,
      regime: c.regime,
      documentos_faltando: faltando,
      prazos: upcoming(data, today, 30, c.regime),
    };
  },
  prazos(data, args, today) {
    return { prazos: upcoming(data, today, Number(args.dias) || 30) };
  },
  registrar_documento(data, args, today) {
    const c = client(data, args);
    const mes = args.mes || month(today);
    const tipo = String(args.tipo || '').trim();
    if (!tipo) throw new Error('Informe o tipo do documento');
    const doc = c.documentos.find((d) => d.mes === mes && d.tipo.toLowerCase() === tipo.toLowerCase());
    if (doc) doc.recebido = true;
    else c.documentos.push({ mes, tipo, recebido: true });
    return { changed: true, registrado: { cliente: c.nome, mes, tipo } };
  },
  pedir_contador(data, args, today) {
    const c = client(data, args);
    const pedido = String(args.pedido || '').trim();
    if (!pedido) throw new Error('Informe o pedido');
    data.solicitacoes.push({ cliente: c.nome, telefone: c.telefone, pedido, em: today.toISOString() });
    return { changed: true, registrado: true, mensagem: 'O contador responsável vai retornar.' };
  },
  pendencias(data, args, today) {
    const mes = args.mes || month(today);
    const clientes = data.clientes
      .map((c) => ({
        nome: c.nome,
        telefone: c.telefone,
        regime: c.regime,
        faltando: c.documentos.filter((d) => d.mes === mes && !d.recebido).map((d) => d.tipo),
      }))
      .filter((c) => args.todos || c.faltando.length > 0);
    return { mes, clientes };
  },
};

export function start({ token, port = 8790, file = join(here, 'dados.json'), now = () => new Date() }) {
  return serve({ name: 'Contador', token: token || '', port, file, example, tools, now });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start({
    token: process.env.CONTADOR_TOKEN,
    port: Number(process.env.CONTADOR_PORT) || 8790,
    file: process.env.CONTADOR_DADOS || join(here, 'dados.json'),
  });
  console.log(`Contador: ferramentas em http://127.0.0.1:${server.address().port}`);
}
