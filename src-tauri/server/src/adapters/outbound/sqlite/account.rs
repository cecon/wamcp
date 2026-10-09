use super::db::{int, text, Shape, SqliteStore};
use crate::application::ports::AccountRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::Account;
use serde_json::Value;

const ACCOUNT: Shape = Shape {
    json: &["settings"],
    bools: &[],
};

impl AccountRepo for SqliteStore {
    fn account(&self) -> Result<Account> {
        let sql = "SELECT id,name,locale,settings,created FROM accounts WHERE id=1";
        self.row(sql, vec![], ACCOUNT)?
            .ok_or_else(|| Error::internal("account missing"))
    }

    fn update_account(&self, name: Option<&str>, locale: Option<&str>, settings: Option<&Value>) -> Result<Account> {
        let mut fields = Vec::new();
        if let Some(name) = name {
            fields.push(("name", text(name)));
        }
        if let Some(locale) = locale {
            fields.push(("locale", text(locale)));
        }
        if let Some(settings) = settings {
            fields.push(("settings", text(serde_json::to_string(settings)?)));
        }
        self.update_fields("accounts", int(1), fields)?;
        self.account()
    }

    fn inactive_conversations(&self, before: i64) -> Result<Vec<i64>> {
        self.with(|c| {
            let sql =
                "SELECT id FROM conversations WHERE status IN ('open','pending') AND last_activity_at<? ORDER BY id";
            let mut statement = c.prepare_cached(sql)?;
            let ids = statement.query_map([before], |r| r.get(0))?;
            ids.collect()
        })
    }
}
