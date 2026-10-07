use crate::domain::error::Result;
use crate::domain::model::{
    Attachment, AttachmentSource, AttributeDefinition, AttributeFields, Contact, ContactChanges, ContactInbox,
    Conversation, ConversationChanges, ConversationCounts, ConversationFilters, CustomFilter, DaySchedule, FilterQuery,
    Inbox, InboxChanges, Message, NewAttachment, NewMessage, WorkingHour,
};
use serde_json::Value;

/// Inboxes backed by WhatsApp sessions (one session = one channel) and their working hours.
pub trait InboxRepo {
    fn inbox(&self, id: i64) -> Result<Option<Inbox>>;
    fn inboxes(&self, ids: Option<&[i64]>) -> Result<Vec<Inbox>>;
    /// Every WhatsApp session is a channel; its inbox is created on first use.
    fn inbox_for_session(&self, session_id: &str) -> Result<Option<Inbox>>;
    /// Creates the missing inbox for every WhatsApp session.
    fn sync_inboxes(&self) -> Result<()>;
    fn update_inbox(&self, id: i64, changes: &InboxChanges) -> Result<Inbox>;
    fn working_hours(&self, inbox_id: i64) -> Result<Vec<WorkingHour>>;
    fn set_working_hours(&self, inbox_id: i64, days: &[DaySchedule]) -> Result<()>;
}

/// Contacts and their per-inbox WhatsApp identities (JIDs).
pub trait ContactRepo {
    fn contact(&self, id: i64) -> Result<Option<Contact>>;
    fn contact_inbox(&self, inbox_id: i64, source_id: &str) -> Result<Option<ContactInbox>>;
    fn contact_by_phone(&self, phone: &str) -> Result<Option<Contact>>;
    fn create_contact(&self, name: Option<&str>, phone: Option<&str>) -> Result<Contact>;
    fn create_contact_inbox(&self, contact_id: i64, inbox_id: i64, source_id: &str) -> Result<ContactInbox>;
    fn contacts(&self, q: &str, page: i64) -> Result<Vec<Contact>>;
    fn update_contact(&self, id: i64, changes: &ContactChanges) -> Result<Contact>;
}

/// Conversations: lifecycle fields, list filters, tab counters, participants and labels.
pub trait ConversationRepo {
    fn conversation_by_id(&self, id: i64) -> Result<Option<Conversation>>;
    fn conversation(&self, display_id: i64) -> Result<Option<Conversation>>;
    fn latest_conversation(&self, contact_inbox_id: i64) -> Result<Option<Conversation>>;
    /// display_id is sequential per account; callers run inside a write transaction.
    fn create_conversation(
        &self,
        inbox_id: i64,
        contact_inbox: &ContactInbox,
        status: &str,
        ts: i64,
    ) -> Result<Conversation>;
    fn update_conversation(&self, id: i64, changes: &ConversationChanges) -> Result<Conversation>;
    fn conversations(&self, filters: &ConversationFilters) -> Result<Vec<Conversation>>;
    fn conversation_counts(&self, filters: &ConversationFilters) -> Result<ConversationCounts>;
    fn contact_conversations(&self, contact_id: i64, visible: Option<&[i64]>) -> Result<Vec<Conversation>>;
    fn due_snoozed(&self, now: i64) -> Result<Vec<i64>>;
    fn add_participant(&self, conversation_id: i64, user_id: i64) -> Result<()>;
    fn participant_ids(&self, conversation_id: i64) -> Result<Vec<i64>>;
    fn remove_participant(&self, conversation_id: i64, user_id: i64) -> Result<()>;
    fn delete_conversation(&self, id: i64) -> Result<()>;
    /// Replaces the conversation's labels with the given label ids.
    fn set_conversation_labels(&self, conversation_id: i64, label_ids: &[i64]) -> Result<Conversation>;
}

/// Support messages with WhatsApp id deduplication.
pub trait MessageRepo {
    fn message(&self, id: i64) -> Result<Option<Message>>;
    /// The stored row, or `None` when the WhatsApp message id was already recorded.
    fn insert_message(&self, message: &NewMessage) -> Result<Option<Message>>;
    fn message_by_source(&self, inbox_id: i64, source_id: &str) -> Result<Option<Message>>;
    fn update_message(&self, id: i64, status: Option<&str>, attributes: Option<&Value>) -> Result<Message>;
    /// Replaces the text (`None` clears it, e.g. for deleted messages).
    fn set_message_content(&self, id: i64, content: Option<&str>) -> Result<()>;
    /// Page of messages before a message id (cursor), oldest first.
    fn messages(&self, conversation_id: i64, before: Option<i64>, limit: i64) -> Result<Vec<Message>>;
}

/// Message attachments and where their bytes come from.
pub trait AttachmentRepo {
    fn insert_attachment(&self, attachment: &NewAttachment) -> Result<Attachment>;
    /// The attachment with its stored path and the WhatsApp message it came from.
    fn attachment_source(&self, id: i64) -> Result<Option<AttachmentSource>>;
    fn set_attachment_file(&self, id: i64, path: &str, size: i64) -> Result<()>;
}

/// Saved views, custom attribute definitions/values and the advanced filter queries.
pub trait CustomDataRepo {
    fn custom_filters(&self, user_id: i64, filter_type: Option<&str>) -> Result<Vec<CustomFilter>>;
    fn custom_filter(&self, id: i64) -> Result<Option<CustomFilter>>;
    fn create_custom_filter(&self, user_id: i64, name: &str, filter_type: &str, query: &Value) -> Result<CustomFilter>;
    fn update_custom_filter(&self, id: i64, name: Option<&str>, query: Option<&Value>) -> Result<CustomFilter>;
    fn delete_custom_filter(&self, id: i64) -> Result<()>;

    fn attribute_definitions(&self, model: Option<&str>) -> Result<Vec<AttributeDefinition>>;
    fn attribute_definition(&self, id: i64) -> Result<Option<AttributeDefinition>>;
    fn create_attribute_definition(&self, definition: &AttributeDefinition) -> Result<AttributeDefinition>;
    fn update_attribute_definition(&self, id: i64, fields: &AttributeFields) -> Result<AttributeDefinition>;
    fn delete_attribute_definition(&self, id: i64) -> Result<()>;

    fn set_conversation_attributes(&self, id: i64, attributes: &Value) -> Result<()>;
    fn set_contact_attributes(&self, id: i64, attributes: &Value) -> Result<()>;
    fn filter_conversations(&self, query: &FilterQuery) -> Result<Vec<Conversation>>;
    fn filter_contacts(&self, query: &FilterQuery) -> Result<Vec<Contact>>;
}
