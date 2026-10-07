use super::db::{int, iso, now_ms, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::crypto::{random_secret, sha256_hex};
use crate::application::ports::{HistoryPage, MirrorRepo};
use crate::domain::error::{Error, Result};
use crate::domain::model::{
    AuditEntry, Chat, ChatUpdate, Credential, IssuedToken, MediaMetadata, MirrorMessage, Session, StoredMedia,
    TokenInfo, WaMessage,
};
use rusqlite::types::Value as Sql;

/// Mirror rows with their media metadata (parsed JSON) joined in.
const MESSAGE: &str = "SELECT m.*, (SELECT metadata FROM message_media x
  WHERE x.session_id=m.session_id AND x.jid=m.jid AND x.id=m.id) AS media FROM messages m";
const MESSAGE_SHAPE: Shape = Shape { json: &["media"], bools: &[] };

impl MirrorRepo for SqliteStore {
    fn sessions(&self) -> Result<Vec<Session>> {
        let sql = "SELECT s.*, (SELECT COUNT(*) FROM messages WHERE session_id=s.id) AS message_count FROM sessions s ORDER BY created";
        self.rows(sql, vec![], PLAIN)
    }

    fn session(&self, id: &str) -> Result<Option<Session>> {
        self.row("SELECT * FROM sessions WHERE id=?", vec![text(id)], PLAIN)
    }

    fn create_session(&self, name: &str) -> Result<Session> {
        let id = uuid::Uuid::new_v4().to_string();
        let sql = "INSERT INTO sessions(id,name,created) VALUES(?,?,?)";
        self.exec(sql, vec![text(id.as_str()), text(name), text(iso(now_ms()))])?;
        self.session(&id)?.ok_or_else(|| Error::internal("session vanished"))
    }

    fn set_status(&self, id: &str, status: &str, phone: Option<&str>) -> Result<()> {
        let sql = "UPDATE sessions SET status=?,phone=COALESCE(?,phone) WHERE id=?";
        self.exec(sql, vec![text(status), opt_text(phone), text(id)]).map(drop)
    }

    fn upsert_chat(&self, session_id: &str, chat: &ChatUpdate) -> Result<()> {
        if chat.jid.is_empty() {
            return Ok(());
        }
        let sql = "INSERT INTO chats(session_id,jid,name,updated) VALUES(?,?,?,?) ON CONFLICT(session_id,jid)
                   DO UPDATE SET name=COALESCE(excluded.name,chats.name),updated=MAX(chats.updated,excluded.updated)";
        let name = chat.name.as_deref().filter(|n| !n.is_empty());
        self.exec(sql, vec![text(session_id), text(chat.jid.as_str()), opt_text(name), int(chat.updated)]).map(drop)
    }

    fn store_message(&self, session_id: &str, m: &WaMessage, media: Option<(&MediaMetadata, &[u8])>) -> Result<bool> {
        let key = vec![text(session_id), text(m.jid.as_str()), text(m.id.as_str())];
        let existed = self.scalar("SELECT 1 FROM messages WHERE session_id=? AND jid=? AND id=?", key.clone())?.is_some();
        self.upsert_chat(session_id, &ChatUpdate { jid: m.jid.clone(), name: None, updated: m.ts })?;
        let sql = "INSERT INTO messages(session_id,jid,id,sender,body,kind,from_me,ts) VALUES(?,?,?,?,?,?,?,?)
                   ON CONFLICT(session_id,jid,id) DO UPDATE SET body=excluded.body,kind=excluded.kind";
        let mut params = key.clone();
        params.extend([text(m.sender.as_str()), text(m.body.as_str()), text(m.kind.as_str()), int(i64::from(m.from_me)), int(m.ts)]);
        self.exec(sql, params)?;
        if let Some((metadata, payload)) = media {
            let sql = "INSERT INTO message_media VALUES(?,?,?,?,?) ON CONFLICT(session_id,jid,id)
                       DO UPDATE SET metadata=excluded.metadata,payload=excluded.payload";
            let mut params = key;
            params.extend([text(serde_json::to_string(metadata)?), Sql::Blob(payload.to_vec())]);
            self.exec(sql, params)?;
        }
        // Only newly stored messages count, so live listeners never see duplicates.
        Ok(!existed)
    }

    fn chats(&self, session_id: &str, q: &str) -> Result<Vec<Chat>> {
        let sql = "SELECT c.*, (SELECT body FROM messages m WHERE m.session_id=c.session_id AND m.jid=c.jid ORDER BY ts DESC LIMIT 1) AS preview
                   FROM chats c WHERE session_id=? AND (COALESCE(name,'') LIKE ? OR jid LIKE ?) ORDER BY updated DESC LIMIT 200";
        let like = text(format!("%{q}%"));
        self.rows(sql, vec![text(session_id), like.clone(), like], PLAIN)
    }

    fn mirror_messages(&self, session_id: &str, jid: &str, page: &HistoryPage) -> Result<Vec<MirrorMessage>> {
        let before = page.before.map_or(Sql::Integer(9_007_199_254_740_991), Sql::Real);
        let sql = format!("{MESSAGE} WHERE m.session_id=? AND m.jid=? AND (m.ts<? OR (m.ts=? AND m.id<?)) ORDER BY m.ts DESC,m.id DESC LIMIT ?");
        let params = vec![
            text(session_id),
            text(jid),
            before.clone(),
            before,
            text(page.before_id.clone().unwrap_or_default()),
            int(page.limit),
        ];
        let mut rows: Vec<MirrorMessage> = self.rows(&sql, params, MESSAGE_SHAPE)?;
        rows.reverse();
        Ok(rows)
    }

    fn search(&self, session_id: &str, q: &str, limit: i64) -> Result<Vec<MirrorMessage>> {
        let sql = format!("{MESSAGE} WHERE m.session_id=? AND m.body LIKE ? ORDER BY m.ts DESC LIMIT ?");
        self.rows(&sql, vec![text(session_id), text(format!("%{q}%")), int(limit)], MESSAGE_SHAPE)
    }

    fn media(&self, session_id: &str, jid: &str, id: &str) -> Result<Option<StoredMedia>> {
        let found = self.with(|c| {
            let sql = "SELECT metadata,payload FROM message_media WHERE session_id=? AND jid=? AND id=?";
            let mut statement = c.prepare_cached(sql)?;
            let mut rows = statement.query([session_id, jid, id])?;
            match rows.next()? {
                Some(row) => Ok(Some((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))),
                None => Ok(None),
            }
        })?;
        match found {
            Some((metadata, payload)) => Ok(Some(StoredMedia { metadata: serde_json::from_str(&metadata)?, payload })),
            None => Ok(None),
        }
    }

    fn issue_token(&self, session_id: &str, name: &str, scope: &str, days: i64) -> Result<IssuedToken> {
        let token = format!("wamcp_{}", random_secret());
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let expires = iso(now + days * 86_400_000);
        self.exec(
            "INSERT INTO tokens(id,session_id,name,hash,scope,created,expires) VALUES(?,?,?,?,?,?,?)",
            vec![text(id.as_str()), text(session_id), text(name), text(sha256_hex(&token)), text(scope), text(iso(now)), text(expires.as_str())],
        )?;
        Ok(IssuedToken { id, token, name: name.into(), scope: scope.into(), expires })
    }

    fn tokens(&self, session_id: &str) -> Result<Vec<TokenInfo>> {
        let sql = "SELECT id,name,scope,created,expires,last_used FROM tokens WHERE session_id=? ORDER BY created DESC";
        self.rows(sql, vec![text(session_id)], PLAIN)
    }

    fn authenticate(&self, session_id: &str, token: &str) -> Result<Option<Credential>> {
        if token.len() > 256 {
            return Ok(None);
        }
        let sql = "SELECT id,scope FROM tokens WHERE session_id=? AND hash=? AND expires>?";
        let found = self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let mut rows = statement.query([session_id, sha256_hex(token).as_str(), iso(now_ms()).as_str()])?;
            rows.next()?.map(|r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).transpose()
        })?;
        let Some((id, scope)) = found else {
            return Ok(None);
        };
        self.exec("UPDATE tokens SET last_used=? WHERE id=?", vec![text(iso(now_ms())), text(id.as_str())])?;
        Ok(Some(Credential { id, session_id: session_id.into(), scope, client_id: None }))
    }

    fn revoke(&self, session_id: &str, token_id: &str) -> Result<()> {
        self.exec("DELETE FROM tokens WHERE session_id=? AND id=?", vec![text(session_id), text(token_id)]).map(drop)
    }

    fn event_principal(&self, session_id: &str, token_id: &str) -> Result<Option<Credential>> {
        let sql = "SELECT scope FROM tokens WHERE session_id=? AND id=? AND expires>?";
        let scope = self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let mut rows = statement.query([session_id, token_id, iso(now_ms()).as_str()])?;
            rows.next()?.map(|r| r.get::<_, String>(0)).transpose()
        })?;
        Ok(scope.map(|scope| Credential { id: token_id.into(), session_id: session_id.into(), scope, client_id: None }))
    }

    fn audit(&self, session_id: &str, token_id: &str, action: &str) -> Result<()> {
        let sql = "INSERT INTO audit(session_id,token_id,action,at) VALUES(?,?,?,?)";
        self.exec(sql, vec![text(session_id), text(token_id), text(action), text(iso(now_ms()))]).map(drop)
    }

    fn audit_events(&self, session_id: &str) -> Result<Vec<AuditEntry>> {
        let sql = "SELECT action,at,token_id FROM audit WHERE session_id=? ORDER BY id DESC LIMIT 50";
        self.rows(sql, vec![text(session_id)], PLAIN)
    }
}
