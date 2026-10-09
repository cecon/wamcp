//! Schema of the WA MCP database, identical to the Node version so existing data keeps working.
//! The helpdesk schema is versioned through `PRAGMA user_version`; each step runs in a transaction.

/// Mirror, session token and audit tables (created idempotently before the migrations).
pub const BASE: &str = "
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,status TEXT NOT NULL DEFAULT 'disconnected',created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,jid TEXT NOT NULL,name TEXT,updated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session_id,jid));
CREATE TABLE IF NOT EXISTS messages(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,jid TEXT NOT NULL,id TEXT NOT NULL,sender TEXT,body TEXT NOT NULL,kind TEXT NOT NULL,from_me INTEGER NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(session_id,jid,id));
CREATE INDEX IF NOT EXISTS message_history ON messages(session_id,jid,ts DESC);
CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,scope TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,last_used TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,session_id TEXT,token_id TEXT,action TEXT NOT NULL,at TEXT NOT NULL);
";

/// Media, OAuth and MCP event tables (also idempotent, created after the migrations).
pub const EXTRAS: &str = "
CREATE TABLE IF NOT EXISTS message_media(
  session_id TEXT NOT NULL,jid TEXT NOT NULL,id TEXT NOT NULL,
  metadata TEXT NOT NULL,payload BLOB NOT NULL,
  PRIMARY KEY(session_id,jid,id),
  FOREIGN KEY(session_id,jid,id) REFERENCES messages(session_id,jid,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS oauth_items(bucket TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(bucket,key));
CREATE TABLE IF NOT EXISTS event_subscriptions(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL, principal_kind TEXT NOT NULL, expires INTEGER NOT NULL, value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_subscription_owner ON event_subscriptions(session_id,principal_kind,principal_id);
CREATE TABLE IF NOT EXISTS event_queue(
  subscription_id TEXT NOT NULL REFERENCES event_subscriptions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, event TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(subscription_id,event_id)
);
CREATE INDEX IF NOT EXISTS event_queue_due ON event_queue(next_attempt);
CREATE TABLE IF NOT EXISTS event_receipts(
  subscription_id TEXT NOT NULL REFERENCES event_subscriptions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(subscription_id,event_id)
);
CREATE TABLE IF NOT EXISTS event_attempts(
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
  event_id TEXT NOT NULL, attempt INTEGER NOT NULL, status INTEGER NOT NULL,
  outcome TEXT NOT NULL, at INTEGER NOT NULL
);
";

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ')";

fn json(column: &str) -> String {
    format!("{column} TEXT NOT NULL DEFAULT '{{}}' CHECK(json_valid({column}))")
}

/// Helpdesk migrations v1..v8 (the Node schema), in order.
fn legacy() -> Vec<String> {
    vec![
        // v1: conta única e usuários (agentes de suporte)
        format!(
            "CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,locale TEXT NOT NULL DEFAULT 'pt-BR',
             {},created TEXT NOT NULL);
             INSERT INTO accounts(id,name,created) VALUES(1,'Minha empresa',{NOW});
             CREATE TABLE users(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
               email TEXT NOT NULL COLLATE NOCASE,name TEXT NOT NULL,display_name TEXT,password_hash TEXT NOT NULL,
               role TEXT NOT NULL CHECK(role IN ('administrator','agent')),
               availability TEXT NOT NULL DEFAULT 'offline' CHECK(availability IN ('online','busy','offline')),
               active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,last_login TEXT,UNIQUE(account_id,email));
             CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               csrf TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,last_seen TEXT,user_agent TEXT);
             CREATE INDEX user_sessions_user ON user_sessions(user_id);
             CREATE TABLE api_access_tokens(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL CHECK(owner_type IN ('user','agent_bot')),
               owner_id INTEGER NOT NULL,hash TEXT NOT NULL UNIQUE,created TEXT NOT NULL,last_used TEXT);",
            json("settings")
        ),
        // v2: inboxes e canal WhatsApp (uma sessão = um canal)
        format!(
            "CREATE TABLE channel_whatsapp(id INTEGER PRIMARY KEY,
               session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
               provider TEXT NOT NULL DEFAULT 'baileys' CHECK(provider IN ('baileys')),
               ignore_groups INTEGER NOT NULL DEFAULT 1);
             CREATE TABLE inboxes(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
               name TEXT NOT NULL,channel_type TEXT NOT NULL CHECK(channel_type IN ('whatsapp')),channel_id INTEGER NOT NULL,
               enable_auto_assignment INTEGER NOT NULL DEFAULT 1,greeting_enabled INTEGER NOT NULL DEFAULT 0,greeting_message TEXT,
               lock_to_single_conversation INTEGER NOT NULL DEFAULT 1,allow_messages_after_resolved INTEGER NOT NULL DEFAULT 1,
               timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',created TEXT NOT NULL,UNIQUE(channel_type,channel_id));
             CREATE TABLE inbox_members(inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
               user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(inbox_id,user_id));
             CREATE TABLE inbox_assignment_cursor(inbox_id INTEGER PRIMARY KEY REFERENCES inboxes(id) ON DELETE CASCADE,
               last_user_id INTEGER);
             INSERT INTO channel_whatsapp(session_id) SELECT id FROM sessions;
             INSERT INTO inboxes(name,channel_type,channel_id,created)
               SELECT s.name,'whatsapp',c.id,{NOW} FROM channel_whatsapp c JOIN sessions s ON s.id=c.session_id;"
        ),
        // v3: times
        "CREATE TABLE teams(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
           name TEXT NOT NULL COLLATE NOCASE,description TEXT,allow_auto_assign INTEGER NOT NULL DEFAULT 1,UNIQUE(account_id,name));
         CREATE TABLE team_members(team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(team_id,user_id));"
            .into(),
        // v4: contatos
        format!(
            "CREATE TABLE contacts(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
               name TEXT,phone_number TEXT,email TEXT COLLATE NOCASE,identifier TEXT,{},
               blocked INTEGER NOT NULL DEFAULT 0,last_activity_at INTEGER,created TEXT NOT NULL);
             CREATE UNIQUE INDEX contacts_phone ON contacts(account_id,phone_number) WHERE phone_number IS NOT NULL;
             CREATE TABLE contact_inboxes(id INTEGER PRIMARY KEY,contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
               inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,source_id TEXT NOT NULL,UNIQUE(inbox_id,source_id));",
            json("custom_attributes")
        ),
        // v5: conversas e mensagens de atendimento
        format!(
            "CREATE TABLE conversations(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
               display_id INTEGER NOT NULL,inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
               contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
               contact_inbox_id INTEGER NOT NULL REFERENCES contact_inboxes(id) ON DELETE CASCADE,
               status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','snoozed')),
               priority TEXT CHECK(priority IN ('low','medium','high','urgent')),
               assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
               snoozed_until INTEGER,waiting_since INTEGER,first_reply_at INTEGER,agent_last_seen_at INTEGER,
               last_activity_at INTEGER NOT NULL,{},created TEXT NOT NULL,UNIQUE(account_id,display_id));
             CREATE INDEX conv_inbox_status ON conversations(inbox_id,status,last_activity_at DESC);
             CREATE INDEX conv_assignee ON conversations(assignee_id,status);
             CREATE INDEX conv_contact ON conversations(contact_inbox_id,status);
             CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1,
               conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
               inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
               message_type TEXT NOT NULL CHECK(message_type IN ('incoming','outgoing','activity','template')),
               content TEXT,content_type TEXT NOT NULL DEFAULT 'text',private INTEGER NOT NULL DEFAULT 0,
               status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('pending','sent','delivered','read','failed')),
               sender_type TEXT CHECK(sender_type IN ('user','contact','agent_bot','system')),sender_id INTEGER,
               source_id TEXT,wa_jid TEXT,{},created_at INTEGER NOT NULL);
             CREATE INDEX cmsg_conv ON conversation_messages(conversation_id,created_at,id);
             CREATE UNIQUE INDEX cmsg_source ON conversation_messages(inbox_id,source_id) WHERE source_id IS NOT NULL;
             CREATE TABLE conversation_participants(conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
               user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(conversation_id,user_id));",
            json("custom_attributes"),
            json("content_attributes")
        ),
        // v6: etiquetas e respostas prontas
        "CREATE TABLE labels(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1,title TEXT NOT NULL COLLATE NOCASE,
           description TEXT,color TEXT NOT NULL DEFAULT '#1f93ff',show_on_sidebar INTEGER NOT NULL DEFAULT 1,UNIQUE(account_id,title));
         CREATE TABLE conversation_labels(conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
           label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,PRIMARY KEY(conversation_id,label_id));
         CREATE TABLE contact_labels(contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
           label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,PRIMARY KEY(contact_id,label_id));
         CREATE TABLE canned_responses(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1,
           short_code TEXT NOT NULL COLLATE NOCASE,content TEXT NOT NULL,UNIQUE(account_id,short_code));"
            .into(),
        // v7: notificações e atendimento por IA (bot MCP) por inbox
        "CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           notification_type TEXT NOT NULL,conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
           actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,read_at INTEGER,created_at INTEGER NOT NULL);
         CREATE INDEX notif_user ON notifications(user_id,read_at,id DESC);
         ALTER TABLE inboxes ADD COLUMN agent_bot_enabled INTEGER NOT NULL DEFAULT 0;"
            .into(),
        // v8: webhooks com fila de entrega, automações, horário de atendimento, CSAT e relatórios
        "CREATE TABLE webhooks(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1,
           inbox_id INTEGER REFERENCES inboxes(id) ON DELETE CASCADE,url TEXT NOT NULL,
           subscriptions TEXT NOT NULL CHECK(json_valid(subscriptions)),secret TEXT NOT NULL,
           active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
         CREATE TABLE webhook_deliveries(id INTEGER PRIMARY KEY,webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
           event TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
           attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,response_status INTEGER,last_error TEXT,
           created_at INTEGER NOT NULL);
         CREATE INDEX webhook_due ON webhook_deliveries(status,next_attempt_at);
         CREATE TABLE automation_rules(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1,name TEXT NOT NULL,
           description TEXT,event_name TEXT NOT NULL,conditions TEXT NOT NULL CHECK(json_valid(conditions)),
           actions TEXT NOT NULL CHECK(json_valid(actions)),active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
         CREATE TABLE working_hours(inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
           day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),closed_all_day INTEGER NOT NULL DEFAULT 0,
           open_minutes INTEGER NOT NULL DEFAULT 540,close_minutes INTEGER NOT NULL DEFAULT 1080,PRIMARY KEY(inbox_id,day_of_week));
         ALTER TABLE inboxes ADD COLUMN working_hours_enabled INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE inboxes ADD COLUMN out_of_office_message TEXT;
         ALTER TABLE inboxes ADD COLUMN csat_survey_enabled INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE conversations ADD COLUMN csat_requested_at INTEGER;
         CREATE TABLE csat_responses(id INTEGER PRIMARY KEY,conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
           contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
           inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
           feedback TEXT,created_at INTEGER NOT NULL);
         CREATE TABLE reporting_events(id INTEGER PRIMARY KEY,name TEXT NOT NULL,value INTEGER NOT NULL,
           user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
           conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,created_at INTEGER NOT NULL);
         CREATE INDEX reporting_name_time ON reporting_events(name,created_at);
         CREATE UNIQUE INDEX reporting_first_response ON reporting_events(conversation_id) WHERE name='first_response';"
            .into(),
    ]
}

/// Every helpdesk migration, in order: the Node schema (v1–v8) and the Chatwoot parity steps.
pub fn migrations() -> Vec<String> {
    let mut all = legacy();
    all.extend(super::schema::steps());
    all
}
