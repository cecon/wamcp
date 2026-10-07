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
    ]
}
