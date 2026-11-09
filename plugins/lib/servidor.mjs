// Base dos servidores de referência dos plugins: guarda os dados num arquivo JSON e responde às
// ferramentas do plugin com `POST /<ferramenta>` e `Authorization: Bearer <token>`. Sem
// dependências. Cada plugin só descreve as suas ferramentas: (dados, args, agora) → resposta, com
// `changed: true` quando a ferramenta muda os dados.
import { createServer } from 'node:http';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

/** Os dados do arquivo; na primeira vez, uma cópia do exemplo. */
export function load(file, example) {
  if (!existsSync(file)) copyFileSync(example, file);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const digits = (phone) => String(phone || '').replace(/\D/g, '');

/** O telefone da conversa (o app põe o contato em `contato`) ou, em rotinas internas, `telefone`. */
export const phoneOf = (args) => digits(args.contato?.telefone || args.telefone);

function authorized(header, token) {
  const given = Buffer.from(String(header || '')),
    wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Sobe o servidor em 127.0.0.1. `tools` mapeia o caminho (`/situacao`) para a ferramenta. */
export function serve({ name, token, port, file, example, tools, now = () => new Date() }) {
  if (!token) throw new Error(`Defina o token do plugin ${name}`);
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const tool = req.url.replace(/^\//, '');
    if (req.method !== 'POST' || !Object.hasOwn(tools, tool))
      return send(404, { erro: 'Ferramenta desconhecida' });
    if (!authorized(req.headers.authorization, token)) return send(401, { erro: 'Token inválido' });
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = load(file, example);
        const { changed, ...answer } = tools[tool](data, body ? JSON.parse(body) : {}, now());
        if (changed) writeFileSync(file, JSON.stringify(data, null, 2));
        send(200, answer);
      } catch (error) {
        send(422, { erro: error.message });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
