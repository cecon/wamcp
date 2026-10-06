# Plano: helpdesk estilo Chatwoot sobre o WhatsAppMcp

Status: fases 1, 2 e 3 implementadas no branch `feat/helpdesk-fase1` (2026-10-06). Ficaram de fora macros e atributos customizados.

## Fase 1: o que foi entregue

- **Migrações v1–v5**: conta, usuários, sessões web, tokens de API, inboxes/canal WhatsApp, membros, times, contatos e conversas/mensagens. Ficam em `server/adapters/outbound/sqlite/migrations.mjs` e são versionadas por `PRAGMA user_version`. As sessões existentes viram inboxes automaticamente.
- **Bootstrap do primeiro admin** pela API local, com o admin token:
  - `GET /api/helpdesk/status`
  - `POST /api/helpdesk/bootstrap`
- **API `/api/v1` no listener público**:
  - Login com cookie `HttpOnly; Secure; SameSite=Strict`, CSRF por header `x-csrf-token`, ou header `api_access_token`.
  - Endpoints: agentes, times, inboxes, membros, conversas (lista, meta, detalhe, mensagens, histórico do espelho, status, atribuição, visto) e contatos.
- **Ingestão ao vivo** via `wa.subscribe`:
  - Mensagens `notify`, e `append` do próprio número, abrem ou reabrem conversas.
  - Recibos atualizam o status das mensagens.
  - O envio usa `messageId` pré-gerado, o que evita duplicar o eco do Baileys.
- **Regras de domínio**: roteamento de mensagens, round robin entre agentes online, atividades, snooze com timer de 60 s, proteção do último admin.
- **Testes**: `tests/helpdesk-domain.test.mjs` e `tests/helpdesk-api.test.mjs`.
- **Ainda não entregue**: UI web dos agentes, SSE, etiquetas, respostas prontas, notificações, webhooks e tools MCP de conversa. Tudo isso fica para a fase 2.

## Fase 3: o que foi entregue

- **Migração v8**:
  - Tabelas `webhooks`, `webhook_deliveries` (fila durável), `automation_rules`, `working_hours`, `csat_responses` e `reporting_events`.
  - Novas colunas: `working_hours_enabled`, `out_of_office_message` e `csat_survey_enabled` em `inboxes`; `csat_requested_at` em `conversations`.
- **Domínio puro**: `schedule` (horário por fuso), `automation` (condições E/OU, validação, mapeamento de eventos), `csat` (nota 1–5 em 24 h) e `webhooks` (eventos, backoff, validação de URL).
- **Webhooks**:
  - Fila no SQLite com entrega a cada 10 s.
  - Assinatura `X-Wamcp-Signature` = HMAC-SHA256 de "timestamp.corpo".
  - Até 5 tentativas (30 s, 2 min, 10 min, 1 h). Redirecionamentos não são seguidos.
- **Automações**: eventos `conversation_created`, `conversation_opened`, `conversation_resolved` e `message_created`. As ações passam pelos mesmos casos de uso dos agentes, e um evento causado por automação não dispara outra regra.
- **Mensagens automáticas**:
  - Saudação em conversa nova.
  - Ausência fora do horário, em conversa nova ou reaberta pelo contato.
  - Pesquisa CSAT ao resolver. A resposta registra a nota sem reabrir a conversa, e o contato recebe um agradecimento.
- **Relatórios**: primeira resposta, tempo de resolução, volume e CSAT, por período, caixa e agente.
- **Composição**: `server/compose-helpdesk.mjs` é usado pelo servidor e pelos testes, para que ambos montem o mesmo grafo.
- **UI**:
  - Abas Automações e Webhooks.
  - Painel de mensagens automáticas e horário em cada caixa.
  - Página Relatórios.
  - Prioridade no painel da conversa e rótulo de mensagem automática.

## Fase 2: o que foi entregue

- **Migrações v6–v7**: etiquetas (conversa/contato), respostas prontas, notificações e `inboxes.agent_bot_enabled`.
- **Store SQLite dividido por agregado**: `inbox`, `contact`, `conversation`, `message` e `catalog`, compostos em `helpdesk-store.mjs`.
- **Aplicação**:
  - `conversation-core`: acesso, atividades, atribuição automática e commit com eventos.
  - `ingestion`: WhatsApp → helpdesk.
  - `helpdesk`: ações de agentes e do bot.
  - `catalog`, `notifications` (listener) e `realtime` (filtro por inbox).
- **API**:
  - `/labels`, `/canned_responses` e `/notifications`.
  - `POST /conversations/:id/labels` e filtro `label`.
  - `GET /events` (SSE).
  - `/app` serve a UI com CSP estrita.
- **MCP**:
  - Tools `list_conversations`, `get_conversation`, `reply_conversation`, `set_conversation_status`, `assign_conversation` e `set_conversation_labels`.
  - O cliente MCP atua como bot da inbox. Com o atendimento por IA ligado, a conversa nasce `pending` e `open` faz a passagem para humano.
- **UI web dos agentes** (`agent.html` → `src/agent/`):
  - Login.
  - Caixa de entrada com abas e filtros, conversa em tempo real, compositor com `/atalhos` e notas, painel de responsável, time e etiquetas.
  - Contatos, notificações e configurações (agentes, caixas, times, etiquetas e respostas prontas).
- **Desktop**: página "Atendimento" para criar o primeiro admin e copiar o link do painel.
- **Testes**:
  - Backend: `tests/helpdesk-phase2.test.mjs`.
  - UI: `tests/ui/*.test.tsx` (Vitest + Testing Library). O `npm run check` exige 80% de cobertura.

## Decisões fechadas

- **Hospedagem**: o app desktop continua sendo o host. Ele roda Baileys e guarda tudo em SQLite. Os agentes acessam uma UI web pelo túnel Cloudflare (`https://wamcp.cappyfy.com`).
- **Contas**: uma conta só. A coluna `account_id` já entra nas tabelas principais, com default `1`, para permitir multi-conta no futuro sem precisar migrar.
- **MCP**: continua e passa a operar sobre conversas. Um cliente MCP funciona como um _agent bot_: atende conversas em `pending` e pode passar o atendimento para um humano.
- **Banco**: `node:sqlite` (`DatabaseSync`), o mesmo arquivo `wamcp.sqlite`, em WAL e com FKs ligadas. O banco continua sem dependência nova.

## Conceito central: espelho vs. atendimento

| Camada                       | Tabelas                                                            | Papel                                                                                       |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Espelho WhatsApp (já existe) | `sessions`, `chats`, `messages`, `message_media`                   | Cópia fiel do que o Baileys sincroniza, incluindo histórico completo. Alimenta busca e MCP. |
| Atendimento (novo)           | `inboxes`, `contacts`, `conversations`, `conversation_messages`, … | O fluxo de suporte: quem atende, status, notas e etiquetas.                                 |

O histórico importado (`syncFullHistory`) **não** gera conversas. Só mensagens ao vivo, de `messages.upsert` com tipo `notify`, entram no fluxo de atendimento. Assim, conectar um número antigo não cria milhares de tickets. Quando uma conversa nova é aberta, o agente ainda pode ver o histórico anterior do espelho, carregado sob demanda pelo `jid`.

## Mapeamento Chatwoot → aqui

| Chatwoot                              | Aqui                                                  | Notas                                                      |
| ------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| accounts                              | `accounts`                                            | linha única id=1                                           |
| users + account_users                 | `users` (role admin/agent)                            | com conta única, o papel fica no próprio usuário           |
| inboxes + channel_whatsapp            | `inboxes` + `channel_whatsapp`                        | `channel_whatsapp.session_id` aponta para a sessão Baileys |
| inbox_members                         | `inbox_members`                                       | admins veem tudo                                           |
| teams, team_members                   | iguais                                                |                                                            |
| contacts, contact_inboxes             | iguais                                                | `source_id` = JID                                          |
| conversations                         | `conversations`                                       | `display_id` sequencial por conta                          |
| messages, attachments                 | `conversation_messages` (+ referência ao espelho)     | as mídias usam `message_media` / `get_media`               |
| labels + taggings                     | `labels` + `conversation_labels` (+ `contact_labels`) |                                                            |
| canned_responses                      | igual                                                 |                                                            |
| webhooks                              | igual                                                 | assinatura HMAC-SHA256                                     |
| automation_rules, macros              | fase 3                                                | `conditions` e `actions` guardados como JSON em TEXT       |
| agent_bots                            | `agent_bots`                                          | a integração com o MCP entra aqui                          |
| notifications                         | `notifications`                                       |                                                            |
| round robin (Redis)                   | `inbox_assignment_cursor`                             |                                                            |
| reporting_events, CSAT, working_hours | fase 3                                                |                                                            |
| ActionCable                           | SSE `GET /api/v1/events`                              | atravessa o túnel sem upgrade de WebSocket                 |

## Esquema SQL (fases 1 e 2)

As migrações são versionadas por `PRAGMA user_version`. Cada uma roda numa transação, dentro de um novo `server/adapters/outbound/sqlite/migrations.mjs`. Datas ficam em ISO-8601 (TEXT) e timestamps de mensagem em epoch segundos (INTEGER), como no código atual. Campos JSON ficam em TEXT com `CHECK(json_valid(...))`.

```sql
-- v1: contas e usuários
CREATE TABLE accounts(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pt-BR',
  settings TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings)),
  created TEXT NOT NULL
);
INSERT INTO accounts(id,name,created) VALUES(1,'Minha empresa',strftime('%Y-%m-%dT%H:%M:%fZ'));

CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,            -- scrypt: salt$hash
  role TEXT NOT NULL CHECK(role IN ('administrator','agent')),
  availability TEXT NOT NULL DEFAULT 'offline' CHECK(availability IN ('online','busy','offline')),
  active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL,
  last_login TEXT,
  UNIQUE(account_id,email)
);

CREATE TABLE user_sessions(               -- login web via cookie
  id TEXT PRIMARY KEY,                    -- sha256 do cookie
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created TEXT NOT NULL,
  expires TEXT NOT NULL,
  last_seen TEXT,
  user_agent TEXT
);

CREATE TABLE api_access_tokens(           -- equivalente ao api_access_token do Chatwoot
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('user','agent_bot')),
  owner_id INTEGER NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  last_used TEXT
);

-- v2: inboxes e canais
CREATE TABLE inboxes(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK(channel_type IN ('whatsapp')),
  channel_id INTEGER NOT NULL,
  enable_auto_assignment INTEGER NOT NULL DEFAULT 1,
  greeting_enabled INTEGER NOT NULL DEFAULT 0,
  greeting_message TEXT,
  lock_to_single_conversation INTEGER NOT NULL DEFAULT 1,
  allow_messages_after_resolved INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created TEXT NOT NULL,
  UNIQUE(channel_type,channel_id)
);

CREATE TABLE channel_whatsapp(
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'baileys' CHECK(provider IN ('baileys')),
  ignore_groups INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE inbox_members(
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(inbox_id,user_id)
);

CREATE TABLE inbox_assignment_cursor(
  inbox_id INTEGER PRIMARY KEY REFERENCES inboxes(id) ON DELETE CASCADE,
  last_user_id INTEGER
);

-- v3: times
CREATE TABLE teams(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  allow_auto_assign INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id,name)
);
CREATE TABLE team_members(
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(team_id,user_id)
);

-- v4: contatos
CREATE TABLE contacts(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
  name TEXT,
  phone_number TEXT,                      -- E.164
  email TEXT COLLATE NOCASE,
  identifier TEXT,
  custom_attributes TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_attributes)),
  blocked INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX contacts_phone ON contacts(account_id,phone_number) WHERE phone_number IS NOT NULL;

CREATE TABLE contact_inboxes(
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,                -- JID (5511...@s.whatsapp.net ou @lid)
  UNIQUE(inbox_id,source_id)
);

-- v5: conversas
CREATE TABLE conversations(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
  display_id INTEGER NOT NULL,
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_inbox_id INTEGER NOT NULL REFERENCES contact_inboxes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','snoozed')),
  priority TEXT CHECK(priority IN ('low','medium','high','urgent')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  snoozed_until INTEGER,
  waiting_since INTEGER,
  first_reply_at INTEGER,
  agent_last_seen_at INTEGER,
  last_activity_at INTEGER NOT NULL,
  custom_attributes TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_attributes)),
  created TEXT NOT NULL,
  UNIQUE(account_id,display_id)
);
CREATE INDEX conv_inbox_status ON conversations(inbox_id,status,last_activity_at DESC);
CREATE INDEX conv_assignee ON conversations(assignee_id,status);
CREATE INDEX conv_contact ON conversations(contact_inbox_id,status);
-- display_id: calculado na mesma transação do INSERT, com
-- (SELECT COALESCE(MAX(display_id),0)+1 FROM conversations WHERE account_id=?)
-- O DatabaseSync é síncrono e o processo é único, então não há corrida.

CREATE TABLE conversation_messages(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK(message_type IN ('incoming','outgoing','activity','template')),
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'text',
  private INTEGER NOT NULL DEFAULT 0,     -- nota interna, nunca vai ao WhatsApp
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('pending','sent','delivered','read','failed')),
  sender_type TEXT CHECK(sender_type IN ('user','contact','agent_bot','system')),
  sender_id INTEGER,
  source_id TEXT,                         -- id da mensagem no WhatsApp (dedupe + recibos)
  wa_jid TEXT,                            -- link com o espelho messages(session_id,jid,id)
  content_attributes TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(content_attributes)),
  created_at INTEGER NOT NULL
);
CREATE INDEX cmsg_conv ON conversation_messages(conversation_id,created_at);
CREATE UNIQUE INDEX cmsg_source ON conversation_messages(inbox_id,source_id) WHERE source_id IS NOT NULL;

CREATE TABLE conversation_participants(
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(conversation_id,user_id)
);

-- v6: etiquetas e respostas prontas
CREATE TABLE labels(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#1f93ff',
  show_on_sidebar INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id,title)
);
CREATE TABLE conversation_labels(
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(conversation_id,label_id)
);
CREATE TABLE contact_labels(
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(contact_id,label_id)
);
CREATE TABLE canned_responses(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1,
  short_code TEXT NOT NULL COLLATE NOCASE,
  content TEXT NOT NULL,
  UNIQUE(account_id,short_code)
);

-- v7: bots, notificações, webhooks
CREATE TABLE agent_bots(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('mcp','webhook')),
  outgoing_url TEXT,
  created TEXT NOT NULL
);
CREATE TABLE agent_bot_inboxes(
  inbox_id INTEGER PRIMARY KEY REFERENCES inboxes(id) ON DELETE CASCADE,
  agent_bot_id INTEGER NOT NULL REFERENCES agent_bots(id) ON DELETE CASCADE
);
CREATE TABLE notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,        -- conversation_assignment, conversation_mention, assigned_conversation_new_message, conversation_creation
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  actor_user_id INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notif_user ON notifications(user_id,read_at,created_at DESC);
CREATE TABLE webhooks(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL DEFAULT 1,
  inbox_id INTEGER REFERENCES inboxes(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  subscriptions TEXT NOT NULL CHECK(json_valid(subscriptions)),
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
```

### Migração dos dados atuais

- Para cada linha de `sessions`, criar `channel_whatsapp` e uma `inbox` com o mesmo nome.
- O primeiro login cria o **administrador** pela UI local, já autenticada pelo admin token. A partir daí, convites e criação de agentes ficam com o admin.
- `chats` e `messages` não mudam.

## Regras de negócio (domínio puro, testável)

`server/domain/conversation.mjs`:

1. **Mensagem recebida (incoming)**:
   - Ignorar grupos se `channel_whatsapp.ignore_groups` estiver ligado. Fazer upsert de `contact` e `contact_inbox` a partir do JID.
   - Se `lock_to_single_conversation` estiver ligado, reabrir a última conversa não resolvida, ou, conforme `allow_messages_after_resolved`, a resolvida mais recente, que passa de `resolved` para `open`. Caso contrário, criar uma conversa nova.
   - Conversa `snoozed` volta para `open`.
   - Se a inbox tem agent bot, a conversa nova nasce como `pending`. Senão, nasce como `open` e passa pelo auto-assign.
2. **Mensagem enviada (outgoing)**:
   - Uma nota `private` não chama o WhatsApp.
   - Nos outros casos, chamar `wa.send` e gravar o `source_id` retornado. Em erro, gravar `status=failed` e `content_attributes.external_error`.
   - A primeira resposta de agente preenche `first_reply_at`.
3. **Mensagem enviada pelo próprio celular (from_me)**: entra na conversa como `outgoing` com `sender_type='system'`, para manter o atendimento coerente.
4. **Recibos**: `messages.update` do Baileys, buscado por `source_id`, atualiza o status para `delivered` ou `read`.
5. **Atividades**: cada mudança de status, assignee, team ou etiqueta gera uma `conversation_messages` com `message_type='activity'` (ex.: "Eduardo atribuiu a conversa a Maria").
6. **Auto-assign (round robin)**:
   - Candidatos: membros da inbox com `availability='online'` e `active=1`. Se a conversa tem time com `allow_auto_assign` ligado, os candidatos ficam restritos aos membros desse time.
   - Escolher o próximo candidato depois de `inbox_assignment_cursor.last_user_id`.
7. **Snooze**: um timer de 60s reabre conversas com `snoozed_until` vencido.
8. **Permissões**:
   - `administrator` vê e edita tudo.
   - `agent` vê só as conversas das inboxes de que é membro. Pode atribuir conversas a si mesmo e, como no Chatwoot, a outros agentes.
   - Configurações (inboxes, agentes, times, etiquetas, webhooks) são exclusivas do admin. Respostas prontas podem ser criadas por qualquer usuário.

## Eventos e tempo real

Um `EventBus` (EventEmitter em `server/application/events.mjs`) distribui os eventos para os listeners:

- **SSE**: o broadcast respeita permissões. Admins recebem tudo; agentes recebem eventos das suas inboxes, mais `notification.*` próprios.
- **Webhooks**: POST assinado com `X-Wamcp-Signature: sha256=<hmac>`. Retries com backoff ficam numa tabela `webhook_deliveries` (fase 3).
- **Notifications**: grava a notificação e emite `notification.created`.
- **AgentBot/MCP**: para bots `webhook`, faz POST em `outgoing_url`.

Eventos: `conversation.created`, `conversation.updated`, `conversation.status_changed`, `assignee.changed`, `team.changed`, `message.created`, `message.updated`, `conversation.typing_on/off`, `contact.created/updated`, `notification.created`, `presence.update`.

## Autenticação e exposição

| Superfície                                  | Listener              | Auth                                                                                           |
| ------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| UI do dono (Tauri)                          | admin 17381           | admin token (como hoje) e bootstrap do primeiro admin                                          |
| UI web dos agentes `/app` + API `/api/v1/*` | público 17382 (túnel) | cookie `HttpOnly; Secure; SameSite=Strict`, header CSRF, rate limit no login, senha com scrypt |
| API para integrações                        | público 17382         | header `api_access_token` (usuário ou bot)                                                     |
| MCP `/mcp/:sessionId`                       | público 17382         | igual a hoje (token/OAuth)                                                                     |

O build Vite é servido como arquivos estáticos em `/app`. O roteamento interno passa a ser por hash ou por estado, e a mesma base React atende tanto o Tauri quanto a web.

## API REST (`/api/v1`)

Conta única, então não há `/accounts/:id` no path. Se um dia virar multi-conta, basta prefixar.

```
POST   /auth/login | /auth/logout        GET /auth/me
PATCH  /profile  (name, password, availability)

GET|POST          /agents             PATCH|DELETE /agents/:id                 (admin)
GET|POST          /inboxes            GET|PATCH|DELETE /inboxes/:id            (admin escreve)
GET|POST|DELETE   /inboxes/:id/members
GET               /inboxes/:id/assignable_agents
GET|POST          /teams              PATCH|DELETE /teams/:id
GET|POST|DELETE   /teams/:id/members

GET    /conversations?status=&assignee_type=me|unassigned|all&inbox_id=&team_id=&labels=&q=&page=
GET    /conversations/meta              (contagens por aba)
GET    /conversations/:display_id
POST   /conversations/:display_id/toggle_status     {status, snoozed_until}
POST   /conversations/:display_id/toggle_priority   {priority}
POST   /conversations/:display_id/assignments       {assignee_id | team_id}
POST   /conversations/:display_id/labels            {labels:[...]}  (substitui)
POST   /conversations/:display_id/update_last_seen
POST   /conversations/:display_id/typing            {status:on|off}
GET    /conversations/:display_id/messages?before=
POST   /conversations/:display_id/messages          {content, private}
GET    /conversations/:display_id/history?before=   (espelho WhatsApp anterior)

GET|POST /contacts   GET|PATCH /contacts/:id   GET /contacts/:id/conversations   GET /contacts/search?q=
GET|POST /labels     PATCH|DELETE /labels/:id
GET|POST /canned_responses   PATCH|DELETE /canned_responses/:id
GET|POST /webhooks   PATCH|DELETE /webhooks/:id
GET /notifications   POST /notifications/read_all   PATCH /notifications/:id   GET /notifications/unread_count
GET /events   (SSE)
```

Validação com zod em `schemas.mjs`, seguindo o padrão atual.

## MCP integrado

As tools atuais (`list_chats`, `get_messages`, `send_message`, …) continuam iguais. Entram tools novas, todas limitadas à inbox da sessão da URL:

- `list_conversations(status?, assignee?, label?)`
- `get_conversation(display_id)`: inclui as mensagens.
- `reply_conversation(display_id, content, private?)`: quem envia é o agent bot do tipo `mcp`.
- `set_conversation_status(display_id, status)`: `resolved`, `open` (passagem para humano) ou `pending`.
- `assign_conversation(display_id, assignee_id | team_id)`
- `add_labels(display_id, labels[])`

Fluxo de bot: inbox com bot MCP → conversa nasce `pending` → a IA responde → `set_conversation_status(open)` faz a passagem para humano, que dispara o auto-assign e emite `conversation.bot_handoff`.

## Arquivos novos e alterados (arquitetura hexagonal)

```
server/domain/conversation.mjs        regras puras (status, reabertura, round robin, permissões)
server/domain/users.mjs               hash/verify de senha (scrypt), validação de papéis
server/application/helpdesk.mjs       casos de uso (receber/enviar msg, atribuir, etiquetar…)
server/application/users.mjs          login, agentes, times, inboxes
server/application/events.mjs         EventBus + listeners
server/adapters/outbound/sqlite/migrations.mjs
server/adapters/outbound/sqlite/helpdesk-store.mjs
server/adapters/inbound/helpdesk-routes.mjs
server/adapters/inbound/web-auth.mjs  cookie + CSRF
server/adapters/inbound/sse.mjs
server/adapters/outbound/webhooks.mjs
server/adapters/outbound/whatsapp.mjs ← emitir eventos live (notify), recibos
server/adapters/inbound/mcp-tools.mjs ← novas tools de conversa
src/                                  ← telas: Login, Inbox (lista+conversa+painel contato), Configurações (Agentes, Inboxes, Times, Etiquetas, Respostas prontas, Webhooks)
scripts/check-architecture.mjs        ← registrar novos módulos
tests/helpdesk-*.test.mjs             ← fake WA já existente
```

## Fases

**Fase 1: base**

- Migrações v1–v5 e `migrations.mjs`.
- Bootstrap do admin; login web; CRUD de agentes e inboxes; membros.
- Ingestão live → contatos/conversas/mensagens; envio; recibos.
- API de conversas e mensagens; testes de domínio e de integração.

**Fase 2: atendimento**

- UI web: lista com abas Minhas / Não atribuídas / Todas, conversa, painel do contato e compositor com `/atalhos` e notas privadas.
- Times, etiquetas, respostas prontas, atribuição, round robin, snooze.
- SSE, notificações; tools MCP de conversa e agent bot.

**Fase 3: extras**

- Webhooks com retries; automation rules; macros.
- Horário de atendimento e mensagem de ausência; saudação.
- CSAT (texto ou link); `reporting_events` e relatórios (primeira resposta, tempo de resolução).
- Atributos customizados.

## Riscos e pontos em aberto

- **JIDs `@lid`**: o WhatsApp está migrando para LID. É preciso resolver `@lid` para o número (Baileys expõe o mapeamento) e evitar contatos duplicados.
- **Túnel como ponto único**: se o desktop desliga, o helpdesk cai. Isso é aceitável para o modelo atual; na fase 3 dá para avaliar empacotar como serviço Windows.
- **Concorrência SQLite**: o processo único com `DatabaseSync` serializa a escrita. Para dezenas de agentes isso basta; manter transações curtas.
- **Exposição pública**: com login pela internet, o hardening passa a ser obrigatório: rate limit, lockout, CSP, cookies `Secure`, logs de auditoria por usuário.
