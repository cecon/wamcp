/** Helpdesk schema, versioned through PRAGMA user_version. Each step runs in its own transaction. */
const now = "strftime('%Y-%m-%dT%H:%M:%fZ')";
const json = (column) => `${column} TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(${column}))`;

export const migrations = [
  // v1: conta única e usuários (agentes de suporte)
  `CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,locale TEXT NOT NULL DEFAULT 'pt-BR',
     ${json('settings')},created TEXT NOT NULL);
   INSERT INTO accounts(id,name,created) VALUES(1,'Minha empresa',${now});
   CREATE TABLE users(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
     email TEXT NOT NULL COLLATE NOCASE,name TEXT NOT NULL,display_name TEXT,password_hash TEXT NOT NULL,
     role TEXT NOT NULL CHECK(role IN ('administrator','agent')),
     availability TEXT NOT NULL DEFAULT 'offline' CHECK(availability IN ('online','busy','offline')),
     active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,last_login TEXT,UNIQUE(account_id,email));
   CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     csrf TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,last_seen TEXT,user_agent TEXT);
   CREATE INDEX user_sessions_user ON user_sessions(user_id);
   CREATE TABLE api_access_tokens(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL CHECK(owner_type IN ('user','agent_bot')),
     owner_id INTEGER NOT NULL,hash TEXT NOT NULL UNIQUE,created TEXT NOT NULL,last_used TEXT);`,

  // v2: inboxes e canal WhatsApp (uma sessão Baileys = um canal)
  `CREATE TABLE channel_whatsapp(id INTEGER PRIMARY KEY,
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
     SELECT s.name,'whatsapp',c.id,${now} FROM channel_whatsapp c JOIN sessions s ON s.id=c.session_id;`,

  // v3: times
  `CREATE TABLE teams(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
     name TEXT NOT NULL COLLATE NOCASE,description TEXT,allow_auto_assign INTEGER NOT NULL DEFAULT 1,UNIQUE(account_id,name));
   CREATE TABLE team_members(team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(team_id,user_id));`,

  // v4: contatos
  `CREATE TABLE contacts(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
     name TEXT,phone_number TEXT,email TEXT COLLATE NOCASE,identifier TEXT,${json('custom_attributes')},
     blocked INTEGER NOT NULL DEFAULT 0,last_activity_at INTEGER,created TEXT NOT NULL);
   CREATE UNIQUE INDEX contacts_phone ON contacts(account_id,phone_number) WHERE phone_number IS NOT NULL;
   CREATE TABLE contact_inboxes(id INTEGER PRIMARY KEY,contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
     inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,source_id TEXT NOT NULL,UNIQUE(inbox_id,source_id));`,

  // v5: conversas e mensagens de atendimento
  `CREATE TABLE conversations(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
     display_id INTEGER NOT NULL,inbox_id INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
     contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
     contact_inbox_id INTEGER NOT NULL REFERENCES contact_inboxes(id) ON DELETE CASCADE,
     status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','snoozed')),
     priority TEXT CHECK(priority IN ('low','medium','high','urgent')),
     assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
     snoozed_until INTEGER,waiting_since INTEGER,first_reply_at INTEGER,agent_last_seen_at INTEGER,
     last_activity_at INTEGER NOT NULL,${json('custom_attributes')},created TEXT NOT NULL,UNIQUE(account_id,display_id));
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
     source_id TEXT,wa_jid TEXT,${json('content_attributes')},created_at INTEGER NOT NULL);
   CREATE INDEX cmsg_conv ON conversation_messages(conversation_id,created_at,id);
   CREATE UNIQUE INDEX cmsg_source ON conversation_messages(inbox_id,source_id) WHERE source_id IS NOT NULL;
   CREATE TABLE conversation_participants(conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(conversation_id,user_id));`,
];

export function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let step = version; step < migrations.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[step]);
      db.exec(`PRAGMA user_version=${step + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
