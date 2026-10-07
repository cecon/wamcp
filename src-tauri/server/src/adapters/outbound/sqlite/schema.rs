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
    ]
}
