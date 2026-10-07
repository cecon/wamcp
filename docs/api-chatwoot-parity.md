# API de atendimento — recursos de paridade com o Chatwoot

Base: `/api/v1` (cookie de sessão + `x-csrf-token` em métodos que alteram, ou `api_access_token`).
Eventos em tempo real chegam por SSE em `GET /api/v1/events` (`event: <nome>`, `data: {"data": …, "performer": …}`).

## Mensagens

Cada mensagem traz `attachments` (lista) e `content_attributes`:

| Campo                               | Significado                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachments[]`                     | `{id, message_id, file_type: image\|audio\|video\|file\|sticker, mime_type, file_name, file_size, duration, voice, downloaded, data_url}` — `data_url` (`/api/v1/attachments/{id}`) serve o arquivo com a sessão do agente |
| `content_attributes.in_reply_to`    | id da mensagem respondida (citação); `in_reply_to_external_id` é o id no WhatsApp                                                                                                                                          |
| `content_attributes.reactions[]`    | `{emoji, sender_type: contact\|user, sender_id, sender_name}` — uma por remetente                                                                                                                                          |
| `content_attributes.deleted`        | `true` quando apagada (o `content` vira `null`)                                                                                                                                                                            |
| `content_attributes.edited`         | `true` quando editada pelo contato (`previous_content` guarda o texto anterior)                                                                                                                                            |
| `content_attributes.external_error` | motivo da falha quando `status = failed`                                                                                                                                                                                   |

### Enviar

`POST /conversations/{display_id}/messages`

- JSON: `{content, private?, in_reply_to?}`
- `multipart/form-data`: campos `content`, `private`, `in_reply_to`, `voice` (`true` para nota de voz) e um ou mais arquivos em `attachments[]`. O WhatsApp leva um arquivo por mensagem: a legenda e a citação vão no primeiro.
- Limites do WhatsApp: imagem 16 MiB, áudio/vídeo 64 MiB, documento 100 MiB, figurinha 1 MiB.
- Os arquivos ficam na pasta de dados do app em `media/<sessão>/<AAAA>/<MM>/<id>.<ext>`. Mídias recebidas são baixadas em segundo plano assim que chegam.

### Ações

| Rota                                                       | Corpo                                              | Efeito                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /conversations/{id}/messages/{message_id}/reactions` | `{emoji}` (vazio remove)                           | Reage (também no celular do contato)                                                           |
| `DELETE /conversations/{id}/messages/{message_id}`         | —                                                  | Apaga mensagem enviada pela equipe (para todos no WhatsApp) ou nota privada                    |
| `POST /conversations/{id}/messages/{message_id}/retry`     | —                                                  | Reenvia mensagem com falha (mesmo id do WhatsApp)                                              |
| `POST /conversations/{id}/toggle_typing_status`            | `{typing_status: on\|off\|recording, is_private?}` | Mostra "digitando…"/"gravando áudio…" ao contato (exceto em nota privada) e aos outros agentes |
| `POST /conversations/{id}/update_last_seen`                | —                                                  | Marca como vista e envia confirmação de leitura (tique azul) das mensagens novas               |
| `GET /attachments/{attachment_id}`                         | —                                                  | Arquivo (baixa do WhatsApp na hora se ainda não estiver no disco)                              |

### Eventos novos

- `conversation.typing_on` / `conversation.typing_off`: `{id, display_id, inbox_id, recording, is_private, user: {type: contact\|user, id, name}}` (também como webhooks `conversation_typing_on/off`).
- `message.updated` agora também cobre reações, citações recebidas, mensagens apagadas e editadas.

## Filtros avançados, visualizações e atributos personalizados

| Método       | Rota                                    | Descrição                                                                                                                |
| ------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST         | `/conversations/filter?page=`           | `{ "payload": [condição] }`; respeita as caixas visíveis ao agente                                                       |
| POST         | `/contacts/filter?page=`                | Mesmo formato, atributos de contato                                                                                      |
| GET/POST     | `/custom_filters`                       | Visualizações salvas do agente (`?filter_type=conversation\|contact`); corpo `{ name, filter_type, query: { payload } }` |
| PATCH/DELETE | `/custom_filters/{id}`                  | Somente o dono                                                                                                           |
| GET/POST     | `/custom_attribute_definitions`         | Lista (`?attribute_model=`) e cria (administrador)                                                                       |
| PATCH/DELETE | `/custom_attribute_definitions/{id}`    | Administrador; chave e modelo são fixos                                                                                  |
| POST         | `/conversations/{id}/custom_attributes` | `{ "custom_attributes": { chave: valor } }`; mescla, `null` remove                                                       |
| PATCH        | `/contacts/{id}`                        | Aceita também `custom_attributes` (mesma regra)                                                                          |

Condição: `{ attribute_key, filter_operator, values, query_operator }`. O `query_operator` (`and`/`or`) liga a condição à
seguinte, como no Chatwoot. Operadores: `equal_to`, `not_equal_to`, `contains`, `does_not_contain`, `is_present`,
`is_not_present`, `is_greater_than`, `is_less_than` e `days_before` (os três últimos só para números e datas).

Atributos de conversa: `status`, `assignee_id`, `inbox_id`, `team_id`, `labels`, `priority`, `display_id`,
`created_at`, `last_activity_at`, `contact_name`, `contact_phone`, `contact_email`. De contato: `name`, `phone_number`,
`email`, `identifier`, `labels`, `created_at`, `last_activity_at`. Atributos personalizados usam
`custom_attribute:<chave>`.

Tipos de atributo: `text`, `number`, `currency`, `percent`, `link`, `date` (`AAAA-MM-DD`), `list` (valor deve estar em
`attribute_values`) e `checkbox`. `regex_pattern` valida textos e `regex_cue` é a dica exibida ao agente.
`custom_attributes` agora é um objeto JSON nas conversas e contatos.

## Contatos

| Método   | Rota                          | Descrição                                                                                                                  |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/contacts`                   | Cria contato `{ name, phone_number, email, identifier }`; telefone normalizado para `+DDI...` e único                      |
| PATCH    | `/contacts/{id}`              | Edita nome, e-mail, identificador, telefone, `blocked` (bloqueia também no WhatsApp) e `custom_attributes`                 |
| DELETE   | `/contacts/{id}`              | Administrador; remove o contato e as conversas dele                                                                        |
| GET/POST | `/contacts/{id}/notes`        | Notas do contato `{ content }`                                                                                             |
| DELETE   | `/contacts/{id}/notes/{note}` | Autor ou administrador                                                                                                     |
| POST     | `/contacts/{id}/labels`       | `{ labels: [...] }` (etiquetas existentes)                                                                                 |
| POST     | `/contacts/{id}/avatar`       | Busca a foto de perfil do WhatsApp (`avatar_url`)                                                                          |
| POST     | `/actions/contact_merge`      | `{ base_contact_id, mergee_contact_id }`: o base mantém seus dados e recebe canais, conversas, notas e etiquetas           |
| GET      | `/contacts/export`            | CSV (administrador): `name,phone_number,email,identifier,labels`                                                           |
| POST     | `/contacts/import`            | Multipart com `import_file` (administrador); atualiza pelo telefone; responde `{ created, updated, failed[{line,error}] }` |
| POST     | `/conversations`              | `{ contact_id, inbox_id, message: { content } }`: inicia (ou reabre a conversa aberta) e envia a primeira mensagem         |

Mensagens de contatos bloqueados não entram no atendimento (continuam no espelho do WhatsApp). Contatos agora expõem
`labels` e `avatar_url`. Eventos: `contact.created`, `contact.updated` e `contact.deleted`.

## Notificações e menções

| Método       | Rota                                                    | Descrição                                                            |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------------- |
| GET          | `/notifications`                                        | Até 50, sem as adiadas; `{ items, unread }`                          |
| PATCH/DELETE | `/notifications/{id}`                                   | Marca como lida / apaga                                              |
| POST         | `/notifications/{id}/unread`                            | Marca como não lida                                                  |
| POST         | `/notifications/{id}/snooze`                            | `{ snoozed_until }` (epoch s): some até a data e volta como não lida |
| POST         | `/notifications/read_all`, `/notifications/destroy_all` | Todas lidas / apaga todas                                            |
| GET/PATCH    | `/notification_settings`                                | `{ flags: { tipo: true\|false } }`                                   |

Tipos: `conversation_creation`, `conversation_assignment`, `assigned_conversation_new_message`, `conversation_mention`
e `participating_conversation_new_message`. Menções usam o formato do Chatwoot em notas privadas:
`[@Nome](mention://user/<id>/Nome)`. O agente mencionado (com acesso à caixa) passa a participar da conversa, aparece
no filtro `conversation_type=mentions` e recebe a notificação. Participantes (exceto o responsável) são avisados de
novas mensagens do contato.

## Macros e automações

| Método       | Rota                           | Descrição                                                                                                  |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| GET/POST     | `/macros`                      | Globais + pessoais do agente; `{ name, visibility: personal\|global, actions }` (globais só administrador) |
| PATCH/DELETE | `/macros/{id}`                 | Autor (pessoal) ou administrador (global)                                                                  |
| POST         | `/macros/{id}/execute`         | `{ conversation_ids: [display_id] }` → `{ updated, failed[{id,error}] }`; executa como o agente            |
| POST         | `/automation_rules/{id}/clone` | Copia a regra (nome "(cópia)", inativa)                                                                    |

Ações (macros e automações): `assign_agent`, `assign_team`, `remove_assigned_agent`, `remove_assigned_team`,
`add_label`, `remove_label`, `send_message`, `add_private_note`, `resolve_conversation`, `open_conversation`,
`pending_conversation`, `snooze_conversation`, `mute_conversation`, `set_priority`/`change_priority`.

Automações ganharam o evento `conversation_updated`, as condições `priority`, `contact_email` e
`custom_attribute:<chave>` e o operador `starts_with`.

## Segurança da conta

| Método          | Rota                                          | Descrição                                                                                      |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST            | `/auth/login`                                 | Com verificação em duas etapas ativa responde `{ mfa_required: true, mfa_token }` (sem cookie) |
| POST            | `/auth/mfa`                                   | `{ mfa_token, code }` (código TOTP ou de backup) → sessão; desafio vale 5 min e 5 tentativas   |
| GET/POST/DELETE | `/profile/mfa`                                | Estado / inicia (`{ secret, otpauth_uri }`) / desativa (`{ password, code }`)                  |
| POST            | `/profile/mfa/verify`                         | `{ code }` ativa e devolve 10 códigos de backup (exibidos uma única vez)                       |
| DELETE          | `/agents/{id}/mfa`                            | Administrador redefine a verificação de um agente                                              |
| GET             | `/profile/sessions`                           | Sessões ativas (`current` marca a atual)                                                       |
| DELETE          | `/profile/sessions`, `/profile/sessions/{id}` | Encerra as outras sessões / uma sessão                                                         |
| GET             | `/audit_logs?page=`                           | Administrador; 50 por página                                                                   |

TOTP segue a RFC 6238 (SHA-1, 30 s, 6 dígitos, tolerância de um passo, sem reutilizar código). O registro de auditoria
guarda login, ativação/desativação da verificação em duas etapas e toda alteração bem-sucedida de agentes, times,
caixas, etiquetas, respostas prontas, automações, macros, webhooks, atributos e conta, além de exclusões/importações/
mesclagens de contatos e exclusões de conversas, com usuário, IP e rota.

## Conta, caixas de entrada e busca

| Método | Rota                                                     | Descrição                                                                                                                     |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/account`                                               | Nome, idioma e `settings` da conta                                                                                            |
| PATCH  | `/account`                                               | Administrador: `{ name, locale: pt-BR\|en\|es, auto_resolve_duration (dias, 1–999 ou null), auto_resolve_message }`           |
| PATCH  | `/inboxes/{id}`                                          | Também aceita `max_assignment_limit` (1–1000 conversas abertas por agente na distribuição automática) e `csat_survey_message` |
| GET    | `/search?q=&type=all\|conversations\|contacts\|messages` | Até 20 de cada; respeita as caixas visíveis; `#12` busca a conversa 12                                                        |

Com `auto_resolve_duration`, conversas abertas ou pendentes sem atividade pelo número de dias são resolvidas a cada
minuto (enviando `auto_resolve_message`, se definida). Evento `account.updated`.

## Relatórios v2

| Método | Rota                                                                        | Descrição                                                                                |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/reports?metric=&type=&id=&label=&since=&until=&group_by=day\|week\|month` | Série temporal `[{ timestamp, value }]`, com zeros nos períodos vazios                   |
| GET    | `/reports/summary_v2?type=&id=&label=&since=&until=`                        | Cada métrica `{ current, previous }` (período anterior de mesmo tamanho)                 |
| GET    | `/reports/breakdown/inbox\|agent\|team\|label`                              | Métricas por caixa, agente, time ou etiqueta                                             |
| GET    | `/csat_survey_responses/metrics`                                            | `{ total, sent, ratings, average, satisfaction_score, response_rate }`                   |
| GET    | `/csat_survey_responses/download`                                           | CSV das avaliações                                                                       |
| GET    | `/reports/bots`                                                             | Assistente IA: `{ conversations, resolutions, handoffs, resolution_rate, handoff_rate }` |

Métricas: `conversations_count`, `incoming_messages_count`, `outgoing_messages_count`, `resolutions_count`,
`avg_first_response_time` e `avg_resolution_time` (segundos). `type`: `account` (padrão), `inbox`, `agent`, `team` ou
`label` (com `label=<título>`). Período padrão: últimos 7 dias; máximo 1 ano. Somente administradores. Semanas
começam na segunda-feira (UTC). A data de criação da conversa agora é a da primeira mensagem.

## SLA

| Método           | Rota                                  | Descrição                                                                                                                                                                |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET/POST         | `/sla_policies`                       | Lista / cria (administrador) `{ name, description, first_response_time_threshold, next_response_time_threshold, resolution_time_threshold }` (segundos, 60 s a 365 dias) |
| PUT/PATCH/DELETE | `/sla_policies/{id}`                  | Substitui ou remove (administrador)                                                                                                                                      |
| GET/POST         | `/conversations/{id}/sla`             | SLA da conversa `{ policy, applied, state }` / aplica `{ sla_policy_id }`                                                                                                |
| GET              | `/applied_slas/metrics?since=&until=` | `{ total, hit, missed, active, hit_rate }` (administrador)                                                                                                               |

O prazo conta a partir da aplicação (próxima resposta: enquanto o contato aguarda). A cada minuto os SLAs ativos
viram `hit` (resolvida dentro dos prazos) ou `missed`; o perdido gera o evento `sla.missed` e a notificação
`sla_missed` para o responsável. Automações e macros ganharam a ação `add_sla` (parâmetro: id da política). Os prazos
contam em tempo corrido (sem pausar fora do horário de atendimento).
