use serde::{Deserialize, Serialize};

/// A private note an agent left on a contact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContactNote {
    pub id: i64,
    pub contact_id: i64,
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: i64,
}

/// One WhatsApp channel of a contact: the inbox, its session and the contact's JID there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContactChannel {
    pub inbox_id: i64,
    pub session_id: String,
    pub source_id: String,
}

/// Fields of a contact created by an agent or imported from CSV.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewContact {
    pub name: Option<String>,
    pub phone_number: Option<String>,
    pub email: Option<String>,
    pub identifier: Option<String>,
}
