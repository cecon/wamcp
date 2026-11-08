// Servidor de referência do plugin Suporte: guarda a base de conhecimento e os chamados num
// arquivo JSON e responde às ferramentas do plugin. Sem dependências: `node server.mjs`.
//
//   SUPORTE_TOKEN   obrigatório; o mesmo valor vai na credencial "token" do plugin
//   SUPORTE_PORT    porta (padrão 8792), sempre em 127.0.0.1
//   SUPORTE_DADOS   arquivo de dados (padrão ./dados.json, criado a partir de dados.exemplo.json)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phoneOf, serve } from '../lib/servidor.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, 'dados.exemplo.json');
const DAY = 86400000;
const PRIORIDADES = ['baixa', 'normal', 'alta'];
const plain = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Articles ranked by how many of their keywords (or title words) the question has. */
export function search(artigos, pergunta) {
  const texto = plain(pergunta);
  if (!texto.trim()) return [];
  return artigos
    .map((a) => {
      const palavras = [...a.palavras, ...a.titulo.split(/\s+/).filter((w) => w.length > 3)];
      return { artigo: a, pontos: palavras.filter((p) => texto.includes(plain(p))).length };
    })
    .filter((r) => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 3)
    .map(({ artigo }) => ({ id: artigo.id, titulo: artigo.titulo, resposta: artigo.resposta }));
}

const resumo = ({ numero, assunto, status, prioridade, atualizado }) => ({
  numero,
  assunto,
  status,
  prioridade,
  atualizado,
});

/** Each tool: (data, args, now) → answer; `changed` marks a write. */
export const tools = {
  buscar_artigo(data, args) {
    return { produto: data.produto, artigos: search(data.artigos, args.pergunta) };
  },
  abrir_chamado(data, args, now) {
    const telefone = phoneOf(args);
    if (!telefone) throw new Error('Chamado sem o telefone do cliente');
    const assunto = String(args.assunto || '').trim();
    if (!assunto) throw new Error('Informe o assunto');
    const prioridade = PRIORIDADES.includes(args.prioridade) ? args.prioridade : 'normal';
    const numero = data.chamados.reduce((maior, c) => Math.max(maior, c.numero), 0) + 1;
    const chamado = {
      numero,
      telefone,
      nome: args.contato?.nome || '',
      assunto,
      descricao: String(args.descricao || '').trim(),
      prioridade,
      status: 'aberto',
      criado: now.toISOString(),
      atualizado: now.toISOString(),
    };
    data.chamados.push(chamado);
    return { changed: true, chamado: resumo(chamado) };
  },
  meus_chamados(data, args) {
    const telefone = phoneOf(args);
    const chamados = data.chamados
      .filter((c) => c.telefone.replace(/\D/g, '') === telefone && c.status !== 'resolvido')
      .map(resumo);
    return { chamados };
  },
  chamados_parados(data, args, now) {
    const dias = Number(args.dias) || 2;
    const limite = now.getTime() - dias * DAY;
    const chamados = data.chamados
      .filter((c) => c.status !== 'resolvido' && new Date(c.atualizado).getTime() < limite)
      .map((c) => ({ ...resumo(c), telefone: c.telefone, nome: c.nome }));
    return { dias, chamados };
  },
  registrar_retorno(data, args, now) {
    const chamado = data.chamados.find((c) => c.numero === Number(args.numero));
    if (!chamado) throw new Error('Chamado não encontrado');
    chamado.atualizado = now.toISOString();
    return { changed: true, registrado: chamado.numero };
  },
};

export function start({ token, port = 8792, file = join(here, 'dados.json'), now = () => new Date() }) {
  return serve({ name: 'Suporte', token, port, file, example, tools, now });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start({
    token: process.env.SUPORTE_TOKEN,
    port: Number(process.env.SUPORTE_PORT) || 8792,
    file: process.env.SUPORTE_DADOS || join(here, 'dados.json'),
  });
  console.log(`Suporte: ferramentas em http://127.0.0.1:${server.address().port}`);
}
