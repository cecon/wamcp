# Plugin Suporte

Um agente de IA de suporte técnico pelo WhatsApp. Ele procura a resposta na base de conhecimento e conduz o cliente pelos passos; quando a base não resolve, abre um chamado e diz o número. Uma rotina dá notícia aos clientes dos chamados parados, para ninguém ficar sem resposta.

## O que vem aqui

- `plugin.json`: o manifesto (skills, ferramentas, credencial e a rotina de retorno).
- `server.mjs`: um servidor de referência com a base de conhecimento e os chamados num arquivo JSON. Ele não tem dependências. Troque-o pela API do sistema de chamados que a empresa já usa, mantendo os mesmos nomes de ferramenta.
- `dados.exemplo.json`: um provedor de internet de exemplo, copiado para `dados.json` na primeira vez. A equipe atualiza e resolve os chamados nesse arquivo (ou no sistema dela).

## Como ligar

1. Inicie o servidor no mesmo computador do WAMCP: `SUPORTE_TOKEN=um-segredo-longo node plugins/suporte/server.mjs` (porta 8792).
2. Em **Loja → Agentes**, instale o modelo **Suporte técnico** e preencha a credencial `token` com o mesmo segredo. A loja instala o plugin, cria o agente, libera as ferramentas e cria a rotina.

Sem a loja: instale o `plugin.json` em **Configurações → Plugins**, crie o agente com o runtime **OpenCode**, libere as ferramentas `suporte.*` e `mensagens.enviar_whatsapp` em **Motor de agentes** e crie a rotina em **Plugins**.

## Segurança e aprovação

- `abrir_chamado` e `meus_chamados` são `contact_scoped`: o chamado sempre fica no telefone da conversa, e o cliente só vê os próprios chamados.
- `chamados_parados` e `registrar_retorno` são `internal_only`: só a rotina os usa.
- `mensagens.enviar_whatsapp` é `sensitive`: na política padrão, cada retorno espera a aprovação de uma pessoa em **Motor de agentes**.
