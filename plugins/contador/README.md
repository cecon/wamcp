# Plugin Contador

Um agente de IA que atende os clientes de um escritório de contabilidade pelo WhatsApp. Ele tira dúvidas sobre a situação de cada cliente, registra os documentos que o cliente diz ter mandado, cobra os documentos do mês e lembra os prazos. Decisões ficam com o contador: o agente registra o pedido e avisa que alguém do escritório vai retornar.

## O que vem aqui

- `plugin.json`: o manifesto (skills, ferramentas, credencial e duas rotinas sugeridas).
- `server.mjs`: um servidor de referência para os dados do escritório (clientes, documentos, prazos e pedidos para o contador) num arquivo JSON. Ele não tem dependências. Troque-o pela API do sistema que o escritório já usa, mantendo os mesmos nomes de ferramenta.
- `dados.exemplo.json`: dados de exemplo, copiados para `dados.json` na primeira vez.

## Como ligar

1. Inicie o servidor no mesmo computador do WAMCP: `CONTADOR_TOKEN=um-segredo-longo node plugins/contador/server.mjs` (porta 8790).
2. Em **Loja → Agentes**, instale o modelo **Contador** e preencha a credencial `token` com o mesmo segredo. A loja instala o plugin, cria o agente com o runtime **OpenCode**, libera as ferramentas `contador.*` e `mensagens.enviar_whatsapp` e cria as rotinas de cobrança e de prazos.

Sem a loja:

1. Em **Configurações → Plugins**, instale o `plugin.json` e preencha a credencial `token` com o mesmo segredo.
2. Crie o agente de IA em **Funcionários** com o runtime **OpenCode** (só os agentes do motor usam ferramentas) e ligue-o à caixa do WhatsApp.
3. Em **Motor de agentes**, libere para ele as ferramentas `contador.*` e `mensagens.enviar_whatsapp`.
4. Em **Plugins**, use **Criar rotina** para as rotinas de cobrança e de prazos e escolha o agente.

## Segurança e aprovação

- `situacao_do_cliente`, `registrar_documento` e `pedir_contador` são `contact_scoped`: quando um cliente escreve, o app envia à ferramenta o contato daquela conversa. O cliente não consegue ver dados de outro, nem pedindo ao agente.
- `pendencias` é `internal_only`: lista todos os clientes e nunca aparece numa conversa com cliente. Só as rotinas a usam.
- `registrar_documento` é `sensitive` e `mensagens.enviar_whatsapp` também: na política padrão do agente, cada registro e cada mensagem que o agente manda por conta própria espera a aprovação de uma pessoa em **Motor de agentes**.
