//! MCP events extension: the `message.created` event, subscription parameters and payloads.
use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

pub const EVENT_NAME: &str = "message.created";
pub const EVENT_TTL: i64 = 24 * 60 * 60 * 1000;
pub const ROTATION_WINDOW: i64 = 5 * 60 * 1000;
pub const MAX_EVENT_TEXT: usize = 8000;
pub const JID_PATTERN: &str = r"^[0-9][0-9A-Za-z:._-]*@(s\.whatsapp\.net|g\.us|lid)$";

pub static JID: LazyLock<Regex> = LazyLock::new(|| Regex::new(JID_PATTERN).expect("valid regex"));
static SECRET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^whsec_[A-Za-z0-9+/]+={0,2}$").expect("valid regex"));

/// A JSON-RPC error for the events methods (`code`, safe `message`, optional `data.reason`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventError {
    pub message: String,
    pub code: i64,
    pub reason: Option<String>,
}

impl EventError {
    pub fn new(message: &str) -> Self {
        Self::coded(message, -32602)
    }

    pub fn coded(message: &str, code: i64) -> Self {
        Self {
            message: message.into(),
            code,
            reason: None,
        }
    }

    pub fn callback(reason: &str) -> Self {
        Self {
            message: "Falha ao verificar callback".into(),
            code: -32015,
            reason: Some(reason.into()),
        }
    }
}

pub fn event_definition() -> Value {
    json!({
        "name": EVENT_NAME,
        "description": "Uma nova mensagem recebida no WhatsApp, opcionalmente filtrada por conversa. Não inclui histórico nem mensagens enviadas por esta conta.",
        "delivery": ["webhook"],
        "inputSchema": {
            "type": "object",
            "properties": { "jid": { "type": "string", "pattern": JID_PATTERN } },
            "additionalProperties": false
        },
        "payloadSchema": {
            "type": "object",
            "properties": {
                "jid": { "type": "string" },
                "message_id": { "type": "string" },
                "sender": { "type": "string" },
                "text": { "type": "string", "maxLength": MAX_EVENT_TEXT },
                "kind": { "type": "string" },
                "from_me": { "type": "boolean", "const": false },
                "timestamp": { "type": "string", "format": "date-time" },
                "truncated": { "type": "boolean" }
            },
            "required": ["jid", "message_id", "sender", "text", "kind", "from_me", "truncated"],
            "additionalProperties": false
        }
    })
}

/// Who owns a subscription: the session and the credential (token id or OAuth grant id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventOwner {
    pub session_id: String,
    pub principal_id: String,
    pub principal_kind: String,
}

/// Validated subscribe/unsubscribe parameters.
#[derive(Debug, Clone, PartialEq)]
pub struct EventParams {
    pub args: Map<String, Value>,
    pub url: String,
    pub secret: Option<String>,
    pub ttl: Option<i64>,
}

fn valid_secret(secret: &str) -> bool {
    if secret.len() > 94 || !SECRET.is_match(secret) {
        return false;
    }
    let encoded = &secret[6..];
    match STANDARD.decode(encoded) {
        Ok(bytes) => STANDARD.encode(&bytes) == encoded && (24..=64).contains(&bytes.len()),
        Err(_) => false,
    }
}

pub fn event_parameters(params: &Value, subscribing: bool) -> Result<EventParams, EventError> {
    let Some(object) = params.as_object() else {
        return Err(EventError::new("Evento não suportado"));
    };
    if object.get("name").and_then(Value::as_str) != Some(EVENT_NAME) {
        return Err(EventError::new("Evento não suportado"));
    }
    let empty = Value::Object(Map::new());
    let args = object.get("arguments").unwrap_or(&empty);
    let Some(args) = args.as_object().filter(|a| a.keys().all(|k| k == "jid")) else {
        return Err(EventError::new("Argumentos de evento inválidos"));
    };
    if let Some(jid) = args.get("jid") {
        let ok = jid.as_str().is_some_and(|j| j.len() <= 200 && JID.is_match(j));
        if !ok {
            return Err(EventError::new("Conversa inválida"));
        }
    }
    let delivery = object.get("delivery").and_then(Value::as_object);
    let url = delivery
        .filter(|d| d.get("mode").and_then(Value::as_str) == Some("webhook"))
        .and_then(|d| d.get("url")?.as_str())
        .filter(|u| u.len() <= 2048)
        .ok_or_else(|| EventError::new("Entrega webhook inválida"))?;
    let parsed = url::Url::parse(url).map_err(|_| EventError::new("URL de callback inválida"))?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(EventError::new(
            "Callback deve usar HTTPS sem credenciais ou fragmento",
        ));
    }
    let mut result = EventParams {
        args: args.clone(),
        url: parsed.to_string(),
        secret: None,
        ttl: None,
    };
    if subscribing {
        let secret = delivery
            .and_then(|d| d.get("secret")?.as_str())
            .filter(|s| valid_secret(s))
            .ok_or_else(|| EventError::new("Segredo de assinatura inválido"))?;
        if !matches!(object.get("cursor"), None | Some(Value::Null)) {
            return Err(EventError::new(
                "Este evento não oferece replay; cursor deve ser null",
            ));
        }
        let ttl = match object.get("ttlMs") {
            None | Some(Value::Null) => EVENT_TTL,
            Some(v) => v
                .as_i64()
                .filter(|t| *t > 0 && *t <= 9_007_199_254_740_991)
                .ok_or_else(|| EventError::new("ttlMs deve ser um inteiro positivo ou null"))?,
        };
        result.secret = Some(secret.into());
        result.ttl = Some(ttl.min(EVENT_TTL));
    }
    Ok(result)
}

/// Stable identity of a subscription (owner + destination + filter), hashed by the caller.
pub fn subscription_identity(owner: &EventOwner, params: &EventParams) -> String {
    json!([
        owner.session_id,
        owner.principal_kind,
        owner.principal_id,
        params.url,
        EVENT_NAME,
        params.args
    ])
    .to_string()
}

/// ISO-8601 UTC timestamp with milliseconds, like JavaScript's `Date#toISOString`.
pub fn iso_millis(epoch_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(epoch_ms)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Builds the event for a stored live message; `None` for own messages or invalid identifiers.
pub fn message_event(
    session_id: &str,
    message: &crate::domain::model::WaMessage,
    hash: impl Fn(&str) -> String,
) -> Option<Value> {
    let id = &message.id;
    if message.from_me || message.jid.len() > 200 || !JID.is_match(&message.jid) {
        return None;
    }
    if id.is_empty() || id.len() > 300 {
        return None;
    }
    let occurred = iso_millis(message.ts * 1000);
    let truncated = message.body.encode_utf16().count() > MAX_EVENT_TEXT;
    let text: String = message.body.chars().take(MAX_EVENT_TEXT).collect();
    let sender: String = message.sender.chars().take(300).collect();
    let kind: String = message.kind.chars().take(100).collect();
    Some(json!({
        "eventId": format!("evt_{}", hash(&json!([session_id, message.jid, id]).to_string())),
        "name": EVENT_NAME,
        "timestamp": occurred,
        "data": {
            "jid": message.jid,
            "message_id": id,
            "sender": sender,
            "text": text,
            "kind": kind,
            "from_me": false,
            "timestamp": occurred,
            "truncated": truncated
        },
        "cursor": null
    }))
}

pub fn retryable(status: Option<u16>) -> bool {
    match status {
        None | Some(0) | Some(408) | Some(429) => true,
        Some(s) => s >= 500,
    }
}

/// Subscription owners come from the authenticated credential; anything else is rejected.
pub fn validate_owner(owner: &EventOwner) -> Result<(), EventError> {
    let field = |v: &str| !v.is_empty() && v.len() <= 200;
    let kind = owner.principal_kind == "token" || owner.principal_kind == "oauth";
    if kind && field(&owner.session_id) && field(&owner.principal_id) {
        Ok(())
    } else {
        Err(EventError::coded("Identidade de evento inválida", -32001))
    }
}
