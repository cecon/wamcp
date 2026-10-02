# Eventos do WhatsApp no ChatGPT

O endpoint autenticado de cada sessão oferece MCP Events via HTTPS. Um cliente compatível pode assinar `message.created` e receber novas mensagens sem consultar o histórico periodicamente. O ChatGPT decide o que fazer com cada evento conforme a instrução do usuário; instalar a atualização não cria uma assinatura nem autoriza respostas automáticas.

## Protocolo e autorização

- MCP 2.0, revisão `2026-07-28`: `server/discover`, `events/list`, `events/subscribe` e `events/unsubscribe`, no mesmo `/mcp/{sessão}` das ferramentas.
- As ferramentas e os clientes MCP anteriores continuam disponíveis. OAuth, escopos e consentimento de envio permanecem separados da assinatura de eventos.
- A identidade da assinatura inclui a sessão, a credencial local ou autorização OAuth, a URL do callback, o evento e os argumentos canônicos. Renovar o access token OAuth não muda essa identidade.
- Revogar/expirar a credencial ou autorização interrompe a entrega. Desconectar explicitamente a sessão ou sair do WhatsApp remove suas assinaturas. Uma reinicialização normal do aplicativo preserva assinaturas e entregas pendentes.
- O callback e o segredo são fornecidos pelo cliente autenticado em `events/subscribe`; nunca são extraídos do texto recebido no WhatsApp.

## Evento `message.created`

O único filtro é `jid`, opcional, com o identificador exato de uma conversa retornada por `list_chats`. Omitir o filtro monitora as conversas da sessão autorizada. O filtro é aplicado no servidor antes da entrega.

O payload contém `jid`, `message_id`, `sender`, `text`, `kind`, `from_me: false`, `timestamp` e `truncated`. O envelope contém `eventId`, `name`, `timestamp` e `cursor: null`. O texto é limitado a 8.000 caracteres; quando `truncated` for verdadeiro, consulte `get_messages` para ler o registro completo. Anexos continuam disponíveis por `get_media`, sem chaves ou URLs privadas no evento.

Somente mensagens novas recebidas em `messages.upsert` com tipo `notify` geram eventos. Sincronização de histórico, duplicatas, mensagens enviadas pela própria conta, status e mensagens de controle/reação não geram notificações. Essa exclusão de mensagens próprias evita ciclos de resposta automática.

## Entrega e armazenamento

Antes de aceitar a assinatura, o servidor envia um desafio aleatório assinado e exige sua devolução exata. A verificação é reutilizada por até cinco minutos para a mesma identidade, callback e segredo. As requisições usam Standard Webhooks, com `webhook-id`, `webhook-timestamp`, `webhook-signature` e `X-MCP-Subscription-Id`.

Callbacks exigem HTTPS. Os endereços são resolvidos e validados em cada conexão, endereços não públicos são bloqueados, a conexão usa o endereço validado preservando a verificação TLS do hostname, e redirecionamentos não são seguidos. Há limites de tempo, tamanho da resposta e payload de 256 KiB.

A duração padrão e máxima é de 24 horas. `ttlMs` menor é respeitado; `ttlMs: null` recebe uma duração finita. O cliente deve renovar antes de `refreshBefore`. A renovação mantém o ID e substitui o segredo; durante cinco minutos, entregas usam assinaturas com a chave atual e a anterior. `events/unsubscribe` é idempotente e usa a identidade original.

Assinaturas e fila ficam no SQLite local, com os mesmos limites de proteção pelo perfil Windows que o histórico e as credenciais existentes. Os segredos de assinatura precisam ser recuperáveis para assinar os POSTs; não aparecem em respostas de ferramentas ou logs. Não copie o banco para terceiros.

Falhas transitórias de rede, HTTP 408/429 e 5xx têm até oito tentativas com atraso exponencial, preservando o ID do evento e renovando o timestamp/assinatura. HTTP 410 remove a assinatura; HTTP 413 e outros erros permanentes não são repetidos. Um 2xx confirma recebimento pelo callback, não a conclusão de uma resposta do ChatGPT. Uma entrega já em andamento não pode ser desfeita por revogação posterior.

Há limites de 50 assinaturas por identidade, 1.000 no total, 1.000 entregas pendentes por assinatura e 10.000 no total. A integração não oferece replay: mensagens históricas, perdidas durante interrupções ou descartadas por limites de retenção/tentativas não são recuperadas por cursor. O histórico local pode ser consultado separadamente.

## Verificação após atualizar

1. Instale a atualização assinada e reinicie o aplicativo quando solicitado. Confirme que a sessão está conectada.
2. Reescaneie o servidor MCP no plugin do ChatGPT e confirme que `message.created` aparece junto às ferramentas.
3. Em uma conversa compatível ou dot, peça explicitamente para monitorar uma conversa e diga o que fazer quando chegar uma mensagem.
4. Confirme o registro da assinatura e a verificação do callback.
5. Envie uma mensagem de outra conta para a conversa monitorada. Confirme o webhook aceito e a execução na conversa assinante.
6. Envie uma mensagem em outra conversa para verificar o filtro. Pare o monitoramento e confirme que novas mensagens não acionam a tarefa.
7. Se autorizada uma resposta pelo ChatGPT, confirme seu envio e que ela não dispara uma segunda execução. Enviar para a própria conta valida a ferramenta de envio, mas não testa recebimento: mensagens próprias são excluídas.

Os testes automatizados cobrem o contrato HTTP, assinatura, verificação, isolamento, deduplicação, renovação, expiração, reinicialização, revogação, proteção contra SSRF e falhas de entrega. O teste real WhatsApp → callback → execução no ChatGPT depende da instalação atualizada, do plugin reescaneado e de uma assinatura autorizada.

## Referências

- [MCP Events no ChatGPT](https://developers.openai.com/plugins/build/mcp-events)
- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
