use super::db::{int, iso, opt_int, opt_text, placeholders, text, Shape, SqliteStore};
use super::inboxes::PAGE;
use crate::application::ports::ConversationRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{ContactInbox, Conversation, ConversationChanges, ConversationCounts, ConversationFilters};
use crate::domain::roles::ConversationLimit;
use rusqlite::types::Value as Sql;

pub(super) const SELECT: &str =
    "SELECT c.*, ct.name AS contact_name, ct.phone_number AS contact_phone, ci.source_id AS contact_jid,
  i.name AS inbox_name, i.agent_bot_enabled, u.name AS assignee_name, t.name AS team_name,
  (SELECT json_group_array(l.title) FROM (SELECT l.title FROM conversation_labels cl JOIN labels l ON l.id=cl.label_id
     WHERE cl.conversation_id=c.id ORDER BY l.title) l) AS labels,
  (SELECT content FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type<>'activity'
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
  (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type='incoming'
     AND m.created_at>COALESCE(c.agent_last_seen_at,0)) AS unread_count,
  (SELECT a.status FROM applied_slas a WHERE a.conversation_id=c.id) AS sla_status
  FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN contact_inboxes ci ON ci.id=c.contact_inbox_id
  JOIN inboxes i ON i.id=c.inbox_id LEFT JOIN users u ON u.id=c.assignee_id LEFT JOIN teams t ON t.id=c.team_id";
pub(super) const SHAPE: Shape = Shape {
    json: &["labels", "custom_attributes"],
    bools: &[],
};

/// `(assigned to me OR unassigned OR participating)` for agents limited by a custom role.
pub(super) fn limit_clause(limit: &ConversationLimit, args: &mut Vec<Sql>) -> String {
    let mut parts = vec!["c.assignee_id=?"];
    args.push(int(limit.user_id));
    if limit.unassigned {
        parts.push("c.assignee_id IS NULL");
    }
    if limit.participating {
        parts.push("EXISTS(SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.user_id=?)");
        args.push(int(limit.user_id));
    }
    format!("({})", parts.join(" OR "))
}

/// WHERE clauses shared by the list and the tab counters.
fn scope(f: &ConversationFilters) -> (Vec<String>, Vec<Sql>) {
    let (mut wheres, mut args) = (Vec::new(), Vec::new());
    if let Some(status) = f.status.as_deref().filter(|s| *s != "all") {
        wheres.push("c.status=?".to_string());
        args.push(text(status));
    }
    match f.conversation_type.as_deref() {
        Some("unattended") => wheres.push("(c.first_reply_at IS NULL OR c.waiting_since IS NOT NULL)".into()),
        Some("participating") => {
            wheres.push(
                "EXISTS(SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.user_id=?)".into(),
            );
            args.push(opt_int(f.user_id));
        }
        Some("mentions") => {
            wheres.push("EXISTS(SELECT 1 FROM mentions x WHERE x.conversation_id=c.id AND x.user_id=?)".into());
            args.push(opt_int(f.user_id));
        }
        _ => {}
    }
    if let Some(inbox) = f.inbox_id {
        wheres.push("c.inbox_id=?".into());
        args.push(int(inbox));
    }
    if let Some(team) = f.team_id {
        wheres.push("c.team_id=?".into());
        args.push(int(team));
    }
    if let Some(label) = f.label.as_deref().filter(|l| !l.is_empty()) {
        wheres.push("EXISTS(SELECT 1 FROM conversation_labels cl JOIN labels l ON l.id=cl.label_id WHERE cl.conversation_id=c.id AND l.title=?)".into());
        args.push(text(label));
    }
    if let Some(ids) = &f.visible_inbox_ids {
        wheres.push(format!("c.inbox_id IN ({})", placeholders(ids.len())));
        args.extend(ids.iter().map(|id| int(*id)));
    }
    if let Some(limit) = &f.limit {
        let clause = limit_clause(limit, &mut args);
        wheres.push(clause);
    }
    if let Some(q) = f.q.as_deref().filter(|q| !q.is_empty()) {
        wheres.push("(ct.name LIKE ? OR ct.phone_number LIKE ?)".into());
        args.push(text(format!("%{q}%")));
        args.push(text(format!("%{q}%")));
    }
    (wheres, args)
}

/// ORDER BY for a chat list sort (unknown values fall back to the latest activity).
pub(super) fn order(sort: Option<&str>) -> &'static str {
    match sort.unwrap_or_default() {
        "last_activity_at_asc" => "c.last_activity_at ASC, c.id ASC",
        "created_at_desc" => "c.id DESC",
        "created_at_asc" => "c.id ASC",
        "priority_desc" => "CASE c.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, c.last_activity_at DESC",
        "priority_asc" => "CASE c.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END ASC, c.last_activity_at DESC",
        "waiting_since_desc" => "c.waiting_since IS NULL, c.waiting_since DESC, c.id DESC",
        "waiting_since_asc" => "c.waiting_since IS NULL, c.waiting_since ASC, c.id ASC",
        _ => "c.last_activity_at DESC, c.id DESC",
    }
}

fn clause(wheres: &[String], joiner: &str) -> String {
    if wheres.is_empty() {
        String::new()
    } else {
        format!("{joiner} {}", wheres.join(" AND "))
    }
}

fn changes_to_fields(c: &ConversationChanges) -> Vec<(&'static str, Sql)> {
    let mut fields = Vec::new();
    if let Some(status) = &c.status {
        fields.push(("status", text(status.as_str())));
    }
    if let Some(priority) = &c.priority {
        fields.push(("priority", opt_text(priority.as_deref())));
    }
    let optional = [
        ("assignee_id", c.assignee_id),
        ("team_id", c.team_id),
        ("snoozed_until", c.snoozed_until),
        ("waiting_since", c.waiting_since),
        ("first_reply_at", c.first_reply_at),
        ("agent_last_seen_at", c.agent_last_seen_at),
        ("csat_requested_at", c.csat_requested_at),
    ];
    fields.extend(optional.into_iter().filter_map(|(k, v)| v.map(|v| (k, opt_int(v)))));
    if let Some(muted) = c.muted {
        fields.push(("muted", int(i64::from(muted))));
    }
    if let Some(at) = c.last_activity_at {
        fields.push(("last_activity_at", int(at)));
    }
    fields
}

impl SqliteStore {
    fn ids(&self, sql: &str, params: Vec<Sql>) -> Result<Vec<i64>> {
        self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let ids = statement.query_map(rusqlite::params_from_iter(params), |r| r.get(0))?;
            ids.collect()
        })
    }

    fn count(&self, sql: &str, params: Vec<Sql>) -> Result<i64> {
        Ok(self.scalar(sql, params)?.unwrap_or(0))
    }
}

impl ConversationRepo for SqliteStore {
    fn conversation_by_id(&self, id: i64) -> Result<Option<Conversation>> {
        self.row(&format!("{SELECT} WHERE c.id=?"), vec![int(id)], SHAPE)
    }

    fn conversation(&self, display_id: i64) -> Result<Option<Conversation>> {
        self.row(&format!("{SELECT} WHERE c.display_id=?"), vec![int(display_id)], SHAPE)
    }

    fn latest_conversation(&self, contact_inbox_id: i64) -> Result<Option<Conversation>> {
        let sql = format!("{SELECT} WHERE c.contact_inbox_id=? ORDER BY c.id DESC LIMIT 1");
        self.row(&sql, vec![int(contact_inbox_id)], SHAPE)
    }

    fn create_conversation(&self, inbox_id: i64, ci: &ContactInbox, status: &str, ts: i64) -> Result<Conversation> {
        let next = self.count(
            "SELECT COALESCE(MAX(display_id),0)+1 FROM conversations WHERE account_id=1",
            vec![],
        )?;
        let id = self.insert(
            "INSERT INTO conversations(display_id,inbox_id,contact_id,contact_inbox_id,status,waiting_since,last_activity_at,created)
             VALUES(?,?,?,?,?,?,?,?)",
            vec![int(next), int(inbox_id), int(ci.contact_id), int(ci.id), text(status), int(ts), int(ts), text(iso(ts * 1000))],
        )?;
        self.conversation_by_id(id)?
            .ok_or_else(|| Error::internal("conversation vanished"))
    }

    fn update_conversation(&self, id: i64, changes: &ConversationChanges) -> Result<Conversation> {
        self.update_fields("conversations", int(id), changes_to_fields(changes))?;
        self.conversation_by_id(id)?
            .ok_or_else(|| Error::internal("conversation vanished"))
    }

    fn conversations(&self, filters: &ConversationFilters) -> Result<Vec<Conversation>> {
        let (mut wheres, mut args) = scope(filters);
        match filters.assignee_type.as_deref().unwrap_or("all") {
            "me" => {
                wheres.push("c.assignee_id=?".into());
                args.push(opt_int(filters.user_id));
            }
            "unassigned" => wheres.push("c.assignee_id IS NULL".into()),
            "assigned" => wheres.push("c.assignee_id IS NOT NULL".into()),
            _ => {}
        }
        let page = filters.page.max(1);
        args.push(int(PAGE));
        args.push(int((page - 1) * PAGE));
        let sql = format!(
            "{SELECT} {} ORDER BY {} LIMIT ? OFFSET ?",
            clause(&wheres, "WHERE"),
            order(filters.sort_by.as_deref())
        );
        self.rows(&sql, args, SHAPE)
    }

    fn conversation_counts(&self, filters: &ConversationFilters) -> Result<ConversationCounts> {
        let (wheres, args) = scope(filters);
        let base = format!(
            "SELECT COUNT(*) FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE 1=1 {}",
            clause(&wheres, "AND")
        );
        let mut mine_args = args.clone();
        mine_args.push(opt_int(filters.user_id));
        Ok(ConversationCounts {
            mine: self.count(&format!("{base} AND c.assignee_id=?"), mine_args)?,
            unassigned: self.count(&format!("{base} AND c.assignee_id IS NULL"), args.clone())?,
            all: self.count(&base, args)?,
        })
    }

    fn contact_conversations(&self, contact_id: i64, visible: Option<&[i64]>) -> Result<Vec<Conversation>> {
        let filters = ConversationFilters {
            visible_inbox_ids: visible.map(<[i64]>::to_vec),
            ..Default::default()
        };
        let (wheres, args) = scope(&filters);
        let mut params = vec![int(contact_id)];
        params.extend(args);
        let sql = format!(
            "{SELECT} WHERE c.contact_id=? {} ORDER BY c.last_activity_at DESC",
            clause(&wheres, "AND")
        );
        self.rows(&sql, params, SHAPE)
    }

    fn due_snoozed(&self, now: i64) -> Result<Vec<i64>> {
        self.ids(
            "SELECT id FROM conversations WHERE status='snoozed' AND snoozed_until<=?",
            vec![int(now)],
        )
    }

    fn add_participant(&self, conversation_id: i64, user_id: i64) -> Result<()> {
        let sql = "INSERT OR IGNORE INTO conversation_participants(conversation_id,user_id) VALUES(?,?)";
        self.exec(sql, vec![int(conversation_id), int(user_id)]).map(drop)
    }

    fn participant_ids(&self, conversation_id: i64) -> Result<Vec<i64>> {
        self.ids(
            "SELECT user_id FROM conversation_participants WHERE conversation_id=?",
            vec![int(conversation_id)],
        )
    }

    fn set_conversation_labels(&self, conversation_id: i64, label_ids: &[i64]) -> Result<Conversation> {
        self.exec(
            "DELETE FROM conversation_labels WHERE conversation_id=?",
            vec![int(conversation_id)],
        )?;
        for id in label_ids {
            let sql = "INSERT INTO conversation_labels(conversation_id,label_id) VALUES(?,?)";
            self.exec(sql, vec![int(conversation_id), int(*id)])?;
        }
        self.conversation_by_id(conversation_id)?
            .ok_or_else(|| Error::internal("conversation vanished"))
    }

    fn remove_participant(&self, conversation_id: i64, user_id: i64) -> Result<()> {
        let sql = "DELETE FROM conversation_participants WHERE conversation_id=? AND user_id=?";
        self.exec(sql, vec![int(conversation_id), int(user_id)]).map(drop)
    }

    fn delete_conversation(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM conversations WHERE id=?", vec![int(id)])
            .map(drop)
    }
}
