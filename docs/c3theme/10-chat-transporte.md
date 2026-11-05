# Chat — `ChatTransport` sobre a API atual e thread do `@c3theme/chat`

> **Objetivo:** abrir a frente do chat da adoção sem big bang: implementar a **porta `ChatTransport`** do pacote sobre a API que já existe, mapear as mensagens do app para o contrato do C3 Chat e montar a thread nova atrás de `?c3chat`. O thread nativo continua o padrão; 220 testes verdes.

---

## 1. O que foi construído

| Arquivo                                                                    | Papel                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`chat/c3Mapping.ts`](../../src/agent/chat/c3Mapping.ts)                   | traduz `Message`/`Attachment` do app para o contrato neutro do pacote (`direction`, `kind`, `status`, `attachments`, `replyTo`, `meta`, ISO em `createdAt`)                                   |
| [`chat/c3Transport.ts`](../../src/agent/chat/c3Transport.ts)               | implementa `loadMessages` (histórico por `before`), `send` (JSON para texto, multipart para arquivos) e `subscribe` (`message.created/updated/deleted` e `conversation.typing_on/off` do SSE) |
| [`chat/C3Thread.tsx`](../../src/agent/chat/C3Thread.tsx)                   | `MessageList` (virtualizada) + `Composer` do `@c3theme/chat`, com `useMessageWindow`/`useDraft` do núcleo headless e `C3Provider` no escopo                                                   |
| [`ConversationBox.tsx`](../../src/agent/conversations/ConversationBox.tsx) | `?c3chat` troca lista+composer+digitação pelo thread novo (lazy); sem a flag, nada muda                                                                                                       |

Mapa de contrato: `outgoing/template → out`, `incoming → in`, `activity → kind: system`; `pending → sending`; anexos usam `data_url` como `url`; `in_reply_to` vira `replyTo`; reações/nota privada/edição ficam em `meta` (o pacote não interpreta).

## 2. O que o thread novo ainda não cobre (por isso a flag)

Notas privadas, respostas prontas, menções/emoji, reações e ações de mensagem, histórico do WhatsApp, recibos na bolha do contato e "digitando…" (os eventos já são traduzidos, falta ligar a lista). São os itens para o lote de fechamento do chat; até lá o thread nativo segue como padrão.

## 3. Evidências (HEAD desta mudança)

| Verificação                                         | Resultado                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc` + ESLint + arquitetura + limite de 300 linhas | verdes                                                                                                                                                                         |
| Suíte UI                                            | **51 arquivos / 220 testes** — 3 novos em [`chat-c3.test.tsx`](../../tests/ui/chat-c3.test.tsx): mapeamento, transporte (carga/envio/eventos) e thread renderizando + enviando |
| Testes existentes de conversas/composer/voz         | passando sem alteração (a flag está desligada por padrão)                                                                                                                      |
| Build                                               | `C3Thread` 7,0 kB (gzip 2,7) em chunk lazy; `C3Provider` compartilhado 314,0 kB (gzip 100,3); `main` 779,5 kB (gzip 229,8)                                                     |
| Régua                                               | **9 de 153 telas migradas (6%)**                                                                                                                                               |

Detalhe de teste: a `MessageList` do pacote é virtualizada e, no jsdom, todo elemento mede 0 — nenhuma linha renderizaria. O teste do thread simula `getBoundingClientRect`/`clientHeight` para exercitar a renderização e o envio.

## 4. Próximos passos (fechamento)

1. **Ligar digitação e recibos** no thread novo (`updateTypists`/`activeTypists` do núcleo + ações de mensagem) e então decidir quando ele vira o padrão.
2. **Contatos e Relatórios** (lote 4) e **editor de macro** (lote 5) — últimos blocos de tela.
3. **Fechamento da adoção**: shell C3 como padrão (decisão de UX pendente), `progresso:c3 --check` no `pnpm check`, remoção dos caminhos legados e atualização dos documentos de análise.
