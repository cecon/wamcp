//! Chatwoot parity migrations (v9 onwards), appended to the Node schema.

/// Steps after v8, in order; never edit a released step, add a new one.
pub fn steps() -> Vec<String> {
    vec![
        // v9: anexos de mensagens (arquivos em media/<sessão>/<AAAA>/<MM>/ dentro da pasta de dados)
        "CREATE TABLE attachments(id INTEGER PRIMARY KEY,
           message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
           file_type TEXT NOT NULL,mime_type TEXT NOT NULL,file_name TEXT,file_size INTEGER,duration INTEGER,
           voice INTEGER NOT NULL DEFAULT 0,path TEXT,created_at INTEGER NOT NULL);
         CREATE INDEX attachments_message ON attachments(message_id);"
            .into(),
        // v10: conversas silenciadas e menções (@agente) em notas privadas
        "ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
         CREATE TABLE mentions(id INTEGER PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
           message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
           created_at INTEGER NOT NULL,UNIQUE(user_id,message_id));
         CREATE INDEX mentions_user ON mentions(user_id,conversation_id);"
            .into(),
        // v11: visualizações salvas (filtros avançados) e definições de atributos personalizados
        "CREATE TABLE custom_filters(id INTEGER PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name TEXT NOT NULL,filter_type TEXT NOT NULL,query TEXT NOT NULL,created TEXT NOT NULL);
         CREATE INDEX custom_filters_user ON custom_filters(user_id,filter_type);
         CREATE TABLE custom_attribute_definitions(id INTEGER PRIMARY KEY,
           attribute_display_name TEXT NOT NULL,attribute_key TEXT NOT NULL,attribute_model TEXT NOT NULL,
           attribute_display_type TEXT NOT NULL,attribute_description TEXT,attribute_values TEXT NOT NULL DEFAULT '[]',
           regex_pattern TEXT,regex_cue TEXT,created TEXT NOT NULL,UNIQUE(attribute_key,attribute_model));"
            .into(),
        // v12: notas de contato e foto de perfil do WhatsApp
        "CREATE TABLE contact_notes(id INTEGER PRIMARY KEY,
           contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
           user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
         CREATE INDEX contact_notes_contact ON contact_notes(contact_id,created_at);
         ALTER TABLE contacts ADD COLUMN avatar_url TEXT;"
            .into(),
        // v13: notificações adiáveis e preferências de notificação por agente
        "ALTER TABLE notifications ADD COLUMN snoozed_until INTEGER;
         CREATE TABLE notification_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
           flags TEXT NOT NULL DEFAULT '{}');"
            .into(),
        // v14: macros (sequências de ações executadas pelos agentes)
        "CREATE TABLE macros(id INTEGER PRIMARY KEY,name TEXT NOT NULL,
           visibility TEXT NOT NULL CHECK(visibility IN ('personal','global')),
           created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
           actions TEXT NOT NULL CHECK(json_valid(actions)),created TEXT NOT NULL);"
            .into(),
        // v15: autenticação em dois fatores (TOTP) e registro de auditoria
        "ALTER TABLE users ADD COLUMN mfa_secret TEXT;
         ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;
         ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT NOT NULL DEFAULT '[]';
         CREATE TABLE mfa_challenges(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
           action TEXT NOT NULL,auditable_type TEXT NOT NULL,auditable_id INTEGER,details TEXT NOT NULL DEFAULT '{}',
           ip_address TEXT,created_at INTEGER NOT NULL);
         CREATE INDEX audit_logs_created ON audit_logs(created_at DESC);"
            .into(),
        // v16: limite de atribuições por agente e texto da pesquisa CSAT por caixa de entrada
        "ALTER TABLE inboxes ADD COLUMN max_assignment_limit INTEGER;
         ALTER TABLE inboxes ADD COLUMN csat_survey_message TEXT;"
            .into(),
        // v17: políticas de SLA e o SLA aplicado a cada conversa
        "CREATE TABLE sla_policies(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,
           first_response_time_threshold INTEGER,next_response_time_threshold INTEGER,resolution_time_threshold INTEGER,
           created TEXT NOT NULL);
         CREATE TABLE applied_slas(conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
           sla_policy_id INTEGER NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,
           status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hit','missed')),missed_at INTEGER);
         CREATE INDEX applied_slas_status ON applied_slas(status);"
            .into(),
        // v18: robôs de atendimento externos (agent bots) via webhook e token de API
        "ALTER TABLE webhooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'webhook';
         CREATE TABLE agent_bots(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,
           webhook_id INTEGER NOT NULL UNIQUE REFERENCES webhooks(id) ON DELETE CASCADE,created TEXT NOT NULL);
         ALTER TABLE inboxes ADD COLUMN agent_bot_id INTEGER REFERENCES agent_bots(id) ON DELETE SET NULL;"
            .into(),
    ]
}
