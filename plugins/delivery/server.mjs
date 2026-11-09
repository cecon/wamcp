// Servidor de referência do plugin Delivery: guarda o cardápio e os pedidos da loja num arquivo
// JSON e responde às ferramentas do plugin. Sem dependências: `node server.mjs`.
//
//   DELIVERY_TOKEN   obrigatório; o mesmo valor vai na credencial "token" do plugin
//   DELIVERY_PORT    porta (padrão 8791), sempre em 127.0.0.1
//   DELIVERY_DADOS   arquivo de dados (padrão ./dados.json, criado a partir de dados.exemplo.json)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phoneOf, serve } from '../lib/servidor.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, 'dados.exemplo.json');
const cents = (value) => Math.round(Number(value) * 100);
const reais = (value) => value / 100;
const plain = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Prices the items (`[{codigo, quantidade, observacao}]`) with the menu; never trusts the model's. */
export function quote(data, itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new Error('Informe os itens do pedido');
  const problemas = [];
  const linhas = [];
  for (const pedido of itens) {
    const item = data.itens.find((i) => i.codigo === pedido.codigo);
    const quantidade = Math.trunc(Number(pedido.quantidade) || 1);
    if (!item) problemas.push(`Item ${pedido.codigo} não existe no cardápio`);
    else if (!item.disponivel) problemas.push(`${item.nome} está indisponível agora`);
    else if (quantidade < 1 || quantidade > 20) problemas.push(`Quantidade inválida para ${item.nome}`);
    else
      linhas.push({
        codigo: item.codigo,
        nome: item.nome,
        quantidade,
        observacao: pedido.observacao || '',
        valor: reais(cents(item.preco) * quantidade),
      });
  }
  const subtotal = linhas.reduce((soma, l) => soma + cents(l.valor), 0);
  const taxa = cents(data.loja.taxa_entrega);
  return {
    linhas,
    problemas,
    subtotal: reais(subtotal),
    taxa_entrega: reais(taxa),
    total: reais(subtotal + taxa),
  };
}

/** Each tool: (data, args, now) → answer; `changed` marks a write. */
export const tools = {
  cardapio(data, args) {
    const termo = plain(args.termo);
    const itens = data.itens
      .filter((i) => i.disponivel)
      .filter((i) => !args.categoria || plain(i.categoria) === plain(args.categoria))
      .filter((i) => !termo || plain(`${i.nome} ${i.descricao}`).includes(termo))
      .map(({ codigo, nome, categoria, preco, descricao }) => ({
        codigo,
        nome,
        categoria,
        preco,
        descricao,
      }));
    const { nome, horario, taxa_entrega, tempo_estimado_min, pagamentos } = data.loja;
    return { loja: { nome, horario, taxa_entrega, tempo_estimado_min, pagamentos }, itens };
  },
  calcular_pedido(data, args) {
    return quote(data, args.itens);
  },
  fazer_pedido(data, args, now) {
    const telefone = phoneOf(args);
    if (!telefone) throw new Error('Pedido sem o telefone do cliente');
    const conta = quote(data, args.itens);
    if (conta.problemas.length > 0) throw new Error(conta.problemas.join('; '));
    const endereco = String(args.endereco || '').trim();
    if (!endereco) throw new Error('Informe o endereço de entrega');
    if (!data.loja.pagamentos.includes(args.pagamento)) {
      throw new Error(`Forma de pagamento: ${data.loja.pagamentos.join(', ')}`);
    }
    const numero = data.pedidos.reduce((maior, p) => Math.max(maior, p.numero), 0) + 1;
    const previsao = new Date(now.getTime() + data.loja.tempo_estimado_min * 60000).toISOString();
    const pedido = {
      numero,
      telefone,
      nome: args.contato?.nome || args.nome || '',
      itens: conta.linhas,
      total: conta.total,
      endereco,
      pagamento: args.pagamento,
      troco_para: args.troco_para ?? null,
      status: 'recebido',
      criado: now.toISOString(),
      previsao,
      avisado_atraso: false,
    };
    data.pedidos.push(pedido);
    return { changed: true, pedido: { numero, total: conta.total, previsao, status: pedido.status } };
  },
  status_pedido(data, args) {
    const telefone = phoneOf(args);
    const pedidos = data.pedidos
      .filter((p) => p.telefone === telefone)
      .slice(-3)
      .map(({ numero, status, total, previsao }) => ({ numero, status, total, previsao }));
    return { pedidos };
  },
  pedidos_atrasados(data, args, now) {
    const abertos = data.pedidos.filter((p) => !['entregue', 'cancelado'].includes(p.status));
    const atrasados = abertos
      .filter((p) => !p.avisado_atraso && new Date(p.previsao) < now)
      .map(({ numero, telefone, nome, status, previsao }) => ({ numero, telefone, nome, status, previsao }));
    return { atrasados };
  },
  registrar_aviso(data, args) {
    const pedido = data.pedidos.find((p) => p.numero === Number(args.numero));
    if (!pedido) throw new Error('Pedido não encontrado');
    pedido.avisado_atraso = true;
    return { changed: true, registrado: pedido.numero };
  },
};

export function start({ token, port = 8791, file = join(here, 'dados.json'), now = () => new Date() }) {
  return serve({ name: 'Delivery', token, port, file, example, tools, now });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start({
    token: process.env.DELIVERY_TOKEN,
    port: Number(process.env.DELIVERY_PORT) || 8791,
    file: process.env.DELIVERY_DADOS || join(here, 'dados.json'),
  });
  console.log(`Delivery: ferramentas em http://127.0.0.1:${server.address().port}`);
}
