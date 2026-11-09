# Plugin Delivery

Um agente de IA que atende os pedidos de um delivery pelo WhatsApp. Ele mostra o cardápio, monta o pedido com o cliente, calcula o total com os preços da loja (nunca com os do modelo), registra o pedido confirmado e responde sobre o status. Uma rotina avisa os clientes quando o pedido passa da previsão.

## O que vem aqui

- `plugin.json`: o manifesto (skills, ferramentas, credencial e a rotina de atrasos).
- `server.mjs`: um servidor de referência com o cardápio e os pedidos num arquivo JSON. Ele não tem dependências. Troque-o pela API do sistema da loja (PDV, iFood, planilha), mantendo os mesmos nomes de ferramenta.
- `dados.exemplo.json`: uma pizzaria de exemplo, copiada para `dados.json` na primeira vez. A equipe muda o status dos pedidos nesse arquivo (ou no sistema da loja).

## Como ligar

1. Inicie o servidor no mesmo computador do WAMCP: `DELIVERY_TOKEN=um-segredo-longo node plugins/delivery/server.mjs` (porta 8791).
2. Em **Loja → Agentes**, instale o modelo **Atendente de delivery** e preencha a credencial `token` com o mesmo segredo. A loja instala o plugin, cria o agente, libera as ferramentas e cria a rotina.

Sem a loja: instale o `plugin.json` em **Configurações → Plugins**, crie o agente com o runtime **OpenCode**, libere as ferramentas `delivery.*` e `mensagens.enviar_whatsapp` em **Motor de agentes** e crie a rotina em **Plugins**.

## Segurança e aprovação

- `fazer_pedido` e `status_pedido` são `contact_scoped`: o pedido sempre fica no telefone da conversa, e o cliente só vê os próprios pedidos.
- `pedidos_atrasados` e `registrar_aviso` são `internal_only`: só a rotina os usa, nunca uma conversa com cliente.
- `mensagens.enviar_whatsapp` é `sensitive`: na política padrão, cada aviso de atraso espera a aprovação de uma pessoa em **Motor de agentes**. Para mandar sem aprovação, mude a política do agente.
