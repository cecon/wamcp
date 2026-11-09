import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start as delivery } from '../plugins/delivery/server.mjs';
import { start as suporte } from '../plugins/suporte/server.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(`../plugins/${path}`, import.meta.url)));
const catalog = read('catalog.json');

async function serve(start, now, file = join(mkdtempSync(join(tmpdir(), 'plugin-')), 'dados.json')) {
  const server = await start({ token: 't0k3n', port: 0, file, now: () => now });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (tool, args = {}, token = 't0k3n') => {
    const res = await fetch(`${base}/${tool}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, call, file };
}

test('the store lists each plugin at its version and every template uses only its tools', () => {
  for (const entry of catalog.plugins) {
    const manifest = read(entry.url);
    assert.equal(manifest.id, entry.id);
    assert.equal(manifest.version, entry.version);
  }
  for (const template of catalog.agents) {
    const manifest = read(`${template.plugin}/plugin.json`);
    const tools = new Set(manifest.tools.map((t) => `${manifest.id}.${t.name}`));
    for (const { tool } of template.tools) {
      assert.ok(tools.has(tool) || tool === 'mensagens.enviar_whatsapp', `${template.id}: ${tool}`);
    }
    for (const name of template.schedules) {
      assert.ok(
        manifest.schedules.some((s) => s.name === name),
        `${template.id}: ${name}`,
      );
    }
  }
});

test('every tool of the delivery and support manifests is served, with the token', async () => {
  for (const [id, start] of [
    ['delivery', delivery],
    ['suporte', suporte],
  ]) {
    const { server, call } = await serve(start, new Date('2026-11-12T20:00:00Z'));
    try {
      for (const tool of read(`${id}/plugin.json`).tools) {
        assert.equal(new URL(tool.endpoint.url).pathname, `/${tool.name}`);
        assert.notEqual((await call(tool.name, {})).status, 404, `${id}.${tool.name}`);
      }
      assert.equal((await call('apagar_tudo')).status, 404);
      assert.equal((await call(read(`${id}/plugin.json`).tools[0].name, {}, 'errado')).status, 401);
    } finally {
      server.close();
    }
  }
});

test('an order is priced by the store, kept on the customer and reported when late', async () => {
  const now = new Date('2026-11-12T20:00:00Z');
  const { server, call, file } = await serve(delivery, now);
  const contato = { telefone: '+55 11 98888-7777', nome: 'Ana' };
  try {
    const menu = await call('cardapio', { termo: 'calabresa' });
    assert.deepEqual(
      menu.body.itens.map((i) => i.codigo),
      ['P02'],
    );
    const quote = await call('calcular_pedido', {
      itens: [{ codigo: 'P02', quantidade: 2 }, { codigo: 'P03' }, { codigo: 'B01' }],
    });
    assert.equal(quote.body.total, 54.9 * 2 + 12 + 7);
    assert.match(quote.body.problemas[0], /indisponível/);

    const refused = await call('fazer_pedido', {
      contato,
      itens: [{ codigo: 'P03' }],
      endereco: 'Rua A, 1',
      pagamento: 'Pix',
    });
    assert.equal(refused.status, 422);
    const order = await call('fazer_pedido', {
      contato,
      telefone: '5511977776666',
      itens: [{ codigo: 'P01' }],
      endereco: 'Rua A, 1',
      pagamento: 'Pix',
    });
    assert.equal(order.status, 200, JSON.stringify(order.body));
    assert.equal(order.body.pedido.numero, 1);
    assert.equal(order.body.pedido.total, 66.9);
    assert.equal((await call('status_pedido', { contato })).body.pedidos.length, 1);
    assert.equal(
      (await call('status_pedido', { contato: { telefone: '5511977776666' } })).body.pedidos.length,
      0,
    );
  } finally {
    server.close();
  }
  const later = await serve(delivery, new Date(now.getTime() + 3 * 3600000), file);
  try {
    const late = (await later.call('pedidos_atrasados')).body.atrasados;
    assert.deepEqual(
      late.map((p) => [p.numero, p.telefone]),
      [[1, '5511988887777']],
    );
    await later.call('registrar_aviso', { numero: 1 });
    assert.deepEqual((await later.call('pedidos_atrasados')).body, { atrasados: [] });
  } finally {
    later.server.close();
  }
});

test('support answers from the knowledge base, opens tickets per customer and finds stalled ones', async () => {
  const { server, call } = await serve(suporte, new Date('2026-11-12T12:00:00Z'));
  const contato = { telefone: '+5511977776666', nome: 'Bruno' };
  try {
    const found = await call('buscar_artigo', { pergunta: 'Minha internet caiu, está com luz vermelha' });
    assert.equal(found.body.artigos[0].id, 'sem-internet');
    assert.deepEqual((await call('buscar_artigo', { pergunta: 'quero pizza' })).body.artigos, []);

    const ticket = await call('abrir_chamado', { contato, assunto: 'Lenta à noite', prioridade: 'urgente' });
    assert.equal(ticket.body.chamado.numero, 2);
    assert.equal(ticket.body.chamado.prioridade, 'normal');
    const mine = await call('meus_chamados', { contato });
    assert.deepEqual(
      mine.body.chamados.map((c) => c.numero),
      [2],
    );

    const stalled = await call('chamados_parados');
    assert.deepEqual(
      stalled.body.chamados.map((c) => c.numero),
      [1],
    );
    await call('registrar_retorno', { numero: 1 });
    assert.deepEqual((await call('chamados_parados')).body.chamados, []);
  } finally {
    server.close();
  }
});
