//! v34: the GitHub channel. A repository's webhook events become conversations of an inbox whose
//! `channel_type` is `github`; `inboxes` is rebuilt to allow it (SQLite cannot change a CHECK).
use super::db::WITHOUT_FOREIGN_KEYS;

const COLUMNS: &str = "id,account_id,name,channel_type,channel_id,enable_auto_assignment,greeting_enabled,\
greeting_message,lock_to_single_conversation,allow_messages_after_resolved,timezone,created,agent_bot_enabled,\
working_hours_enabled,out_of_office_message,csat_survey_enabled,max_assignment_limit,csat_survey_message,\
agent_bot_id,show_agent_name,ai_agent_id";

pub fn github_channel() -> String {
    format!(
        "{WITHOUT_FOREIGN_KEYS}CREATE TABLE channel_github(id INTEGER PRIMARY KEY,repo TEXT NOT NULL UNIQUE,
           token TEXT NOT NULL,webhook_secret TEXT NOT NULL,own_login TEXT,hook_id INTEGER,created TEXT NOT NULL);
         CREATE TABLE inboxes_v34(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id),
           name TEXT NOT NULL,channel_type TEXT NOT NULL CHECK(channel_type IN ('whatsapp','github')),
           channel_id INTEGER NOT NULL,
           enable_auto_assignment INTEGER NOT NULL DEFAULT 1,greeting_enabled INTEGER NOT NULL DEFAULT 0,
           greeting_message TEXT,lock_to_single_conversation INTEGER NOT NULL DEFAULT 1,
           allow_messages_after_resolved INTEGER NOT NULL DEFAULT 1,
           timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',created TEXT NOT NULL,
           agent_bot_enabled INTEGER NOT NULL DEFAULT 0,working_hours_enabled INTEGER NOT NULL DEFAULT 0,
           out_of_office_message TEXT,csat_survey_enabled INTEGER NOT NULL DEFAULT 0,max_assignment_limit INTEGER,
           csat_survey_message TEXT,agent_bot_id INTEGER REFERENCES agent_bots(id) ON DELETE SET NULL,
           show_agent_name INTEGER NOT NULL DEFAULT 1,ai_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
           UNIQUE(channel_type,channel_id));
         INSERT INTO inboxes_v34({COLUMNS}) SELECT {COLUMNS} FROM inboxes;
         DROP TABLE inboxes;
         ALTER TABLE inboxes_v34 RENAME TO inboxes"
    )
}
