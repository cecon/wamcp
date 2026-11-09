import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextDate, start } from '../plugins/contador/server.mjs';

const manifest = JSON.parse(readFileSync(new URL('../plugins/contador/plugin.json', import.meta.url)));

async function serve() {
  const file = join(mkdtempSync(join(tmpdir(), 'contador-')), 'dados.json');
  const server = await start({ token: 't0k3n', port: 0, file, now: () => new Date('2026-11-12T12:00:00Z') });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (tool, args, token = 't0k3n') => {
    const res = await fetch(`${base}/${tool}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, call, file };
}

test('every tool of the manifest is served, with the token', async () => {
  const { server, call } = await serve();
  try {
    for (const tool of manifest.tools) {
      assert.equal(
        new URL(tool.endpoint.url).pathname,
        `/${tool.name === 'situacao_do_cliente' ? 'situacao' : tool.name}`,
      );
    }
    assert.equal((await call('prazos', {}, 'errado')).status, 401);
    assert.equal((await call('apagar_tudo', {})).status, 404);
  } finally {
    server.close();
  }
});

test('answers about the conversation contact, records documents and requests for the accountant', async () => {
  const { server, call, file } = await serve();
  try {
    // The server-provided contact wins over a phone the model may have picked.
    const own = await call('situacao', {
      contato: { telefone: '+55 11 98888-7777' },
      telefone: '+5511977776666',
    });
    assert.equal(own.status, 200);
    assert.equal(own.body.nome, 'Ana Souza');
    assert.deepEqual(own.body.documentos_faltando, [{ mes: '2026-11', tipo: 'extrato bancário' }]);
    assert.deepEqual(
      own.body.prazos.map((p) => [p.obrigacao, p.vence]),
      [
        ['DAS-MEI', '2026-11-20'],
        ['Enviar os documentos do mês ao escritório', '2026-12-05'],
      ],
    );
    assert.equal((await call('situacao', { contato: { telefone: '+5500000000' } })).status, 422);

    const sent = await call('registrar_documento', {
      contato: { telefone: '+5511988887777' },
      tipo: 'Extrato bancário',
    });
    assert.equal(sent.status, 200);
    const pending = await call('pendencias', {});
    assert.deepEqual(
      pending.body.clientes.map((c) => [c.nome, c.faltando]),
      [['Padaria Sol Ltda', ['folha de pagamento']]],
    );
    await call('pedir_contador', { contato: { telefone: '+5511988887777' }, pedido: 'Quero sair do MEI' });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.solicitacoes[0].pedido, 'Quero sair do MEI');
    assert.equal((await call('pendencias', { todos: true })).body.clientes.length, 2);
  } finally {
    server.close();
  }
});

test('deadlines roll over to the next month once the day has passed', () => {
  assert.equal(nextDate(20, new Date('2026-11-12T00:00:00Z')), '2026-11-20');
  assert.equal(nextDate(5, new Date('2026-11-12T00:00:00Z')), '2026-12-05');
  assert.equal(nextDate(12, new Date('2026-11-12T00:00:00Z')), '2026-11-12');
});
