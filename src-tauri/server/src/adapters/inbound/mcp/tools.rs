//! Tool execution. Credentials are re-checked on every call, read tools are audited and scoped to
//! the session, and send tools require `whatsapp:send`.
use super::catalog::{Scope, Tool};
use crate::adapters::inbound::http::state::AppState;
use crate::application::ports::HistoryPage;
use crate::domain::error::{Error, Result};
use crate::domain::model::{ConversationFilters, Credential};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};

pub const SEND_SCOPE: &str = "whatsapp:read whatsapp:send";

/// One MCP request: the session it targets and the raw bearer credential it presented.
pub struct Call<'a> {
    pub state: &'a AppState,
    pub session_id: &'a str,
    pub credential: &'a str,
}

pub fn challenge(public_url: &str, id: &str, error: &str, scope: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
    format!("Bearer resource_metadata=\"{public_url}/.well-known/oauth-protected-resource/mcp/{encoded}\", scope=\"{scope}\", error=\"{error}\", error_description=\"Autorize esta sessao no WA MCP\"")
}

fn text(message: &str) -> Value {
    json!({ "type": "text", "text": message })
}

fn failure(message: &str) -> Value {
    json!({ "content": [text(message)], "isError": true })
}

fn output(data: &impl serde::Serialize) -> Value {
    json!({ "content": [text(&serde_json::to_string(data).unwrap_or_default())] })
}

fn message_of(error: &Error, fallback: &str) -> String {
    match error {
        Error::Helpdesk(e) => e.message.clone(),
        Error::Internal(_) => fallback.into(),
    }
}

fn arg_str<'a>(args: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn arg_int(args: &Map<String, Value>, key: &str) -> i64 {
    args.get(key).and_then(Value::as_i64).unwrap_or_default()
}

impl Call<'_> {
    fn authenticate(&self) -> Option<Credential> {
        self.state.mcp.authenticate(self.session_id, self.credential)
    }

    fn auth_result(&self, error: &str, scope: &str) -> Value {
        let header = challenge(&self.state.public_url, self.session_id, error, scope);
        json!({
            "isError": true,
            "content": [text("Autorize esta sessão no WA MCP para continuar.")],
            "_meta": { "mcp/www_authenticate": [header] }
        })
    }

    pub async fn run(&self, tool: &Tool, args: &Map<String, Value>) -> Value {
        let Some(token) = self.authenticate() else {
            let scope = if tool.scope == Scope::Send {
                SEND_SCOPE
            } else {
                "whatsapp:read"
            };
            return self.auth_result("invalid_token", scope);
        };
        if tool.scope == Scope::Send && !token.can_send() {
            return self.auth_result("insufficient_scope", SEND_SCOPE);
        }
        match tool.name {
            "get_media" => self.media(&token, args).await,
            "send_message" => self.send(&token, args).await,
            _ if tool.helpdesk => self.helpdesk(tool, &token, args).await,
            _ => self.read(tool.name, &token, args),
        }
    }

    fn read(&self, name: &str, token: &Credential, args: &Map<String, Value>) -> Value {
        let (mcp, id) = (&self.state.mcp, self.session_id);
        let result: Result<Value> = mcp.read(id, token, name, || {
            let repo = &mcp.repo;
            Ok(match name {
                "get_profile" => {
                    let session = mcp.session(id)?.map(|s| s.name).unwrap_or_default();
                    let profile = json!({ "id": id, "name": session });
                    let mut result = output(&profile);
                    result["structuredContent"] = profile;
                    return Ok(result);
                }
                "session_status" => serde_json::to_value(mcp.session(id)?)?,
                "list_chats" => serde_json::to_value(repo.chats(id, arg_str(args, "query").unwrap_or_default())?)?,
                "get_messages" => {
                    let page = HistoryPage {
                        before: args.get("before").and_then(Value::as_f64),
                        before_id: arg_str(args, "beforeId").map(String::from),
                        limit: arg_int(args, "limit"),
                    };
                    serde_json::to_value(repo.mirror_messages(id, arg_str(args, "jid").unwrap_or_default(), &page)?)?
                }
                _ => serde_json::to_value(repo.search(
                    id,
                    arg_str(args, "query").unwrap_or_default(),
                    arg_int(args, "limit"),
                )?)?,
            })
        });
        match result {
            Ok(value) if value.get("structuredContent").is_some() => value,
            Ok(value) => output(&value),
            Err(error) => failure(&message_of(&error, "Operação não concluída.")),
        }
    }

    async fn send(&self, token: &Credential, args: &Map<String, Value>) -> Value {
        let (jid, body) = (
            arg_str(args, "jid").unwrap_or_default(),
            arg_str(args, "text").unwrap_or_default(),
        );
        match self.state.mcp.send(self.session_id, token, jid, body).await {
            Ok(id) => output(&json!({ "id": id })),
            Err(_) => failure("Não foi possível confirmar o envio. Verifique o histórico antes de tentar novamente para evitar duplicatas."),
        }
    }

    async fn media(&self, token: &Credential, args: &Map<String, Value>) -> Value {
        let (jid, message) = (
            arg_str(args, "jid").unwrap_or_default(),
            arg_str(args, "messageId").unwrap_or_default(),
        );
        let file = match self.state.mcp.media(self.session_id, token, jid, message).await {
            Ok(file) => file,
            Err(Error::Helpdesk(e)) => return failure(&e.message),
            Err(_) => return failure("Não foi possível baixar o anexo. Ele pode ter expirado no WhatsApp ou a sessão pode estar desconectada."),
        };
        if self.authenticate().is_none() {
            return self.auth_result("invalid_token", "whatsapp:read");
        }
        let data = STANDARD.encode(&file.data);
        let mut metadata = serde_json::to_value(&file.metadata).unwrap_or_default();
        metadata["size"] = json!(file.data.len());
        let mime = file.metadata.mime_type.clone();
        let attachment = if file.metadata.kind == "audio" && mime.starts_with("audio/") {
            json!({ "type": "audio", "data": data, "mimeType": mime })
        } else {
            let part = |v: &str| url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>();
            let uri = format!(
                "wamcp://sessions/{}/chats/{}/messages/{}",
                part(self.session_id),
                part(jid),
                part(message)
            );
            json!({ "type": "resource", "resource": { "uri": uri, "mimeType": mime, "blob": data } })
        };
        json!({ "content": [text(&metadata.to_string()), attachment] })
    }

    async fn helpdesk(&self, tool: &Tool, token: &Credential, args: &Map<String, Value>) -> Value {
        let mcp = &self.state.mcp;
        let Some(support) = mcp.helpdesk.as_ref() else {
            return failure("Operação não concluída.");
        };
        let id = self.session_id;
        let display = arg_int(args, "display_id");
        let result: Result<Value> = match tool.name {
            "list_conversations" | "get_conversation" => mcp.read(id, token, tool.name, || {
                let bot = support.bot_for(id)?;
                if tool.name == "get_conversation" {
                    let conversation = support.conversation(&bot, display)?;
                    let messages = support.messages(&bot, display, None, arg_int(args, "limit"))?;
                    return Ok(json!({ "conversation": conversation, "messages": messages }));
                }
                let filters = ConversationFilters {
                    status: arg_str(args, "status").map(String::from),
                    label: arg_str(args, "label").map(String::from),
                    q: arg_str(args, "query").map(String::from),
                    page: arg_int(args, "page"),
                    ..Default::default()
                };
                Ok(serde_json::to_value(support.conversations(&bot, filters)?)?)
            }),
            _ => {
                let action = async {
                    let bot = support.bot_for(id)?;
                    let value = match tool.name {
                        "reply_conversation" => {
                            let private = args.get("private").and_then(Value::as_bool).unwrap_or(false);
                            let content = arg_str(args, "content").unwrap_or_default().trim().to_string();
                            serde_json::to_value(support.reply(&bot, display, &content, private).await?)?
                        }
                        "set_conversation_status" => serde_json::to_value(support.toggle_status(
                            &bot,
                            display,
                            arg_str(args, "status").unwrap_or_default(),
                            None,
                        )?)?,
                        "assign_conversation" => {
                            let field = |k: &str| args.get(k).map(Value::as_i64);
                            serde_json::to_value(support.assign(
                                &bot,
                                display,
                                field("assignee_id"),
                                field("team_id"),
                            )?)?
                        }
                        _ => {
                            let labels: Vec<String> = args["labels"]
                                .as_array()
                                .map(|l| l.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                                .unwrap_or_default();
                            serde_json::to_value(support.set_labels(&bot, display, &labels)?)?
                        }
                    };
                    Ok(value)
                };
                mcp.act(id, token, tool.name, action).await
            }
        };
        match result {
            Ok(value) => output(&value),
            Err(error) => failure(&message_of(&error, "Operação não concluída.")),
        }
    }
}
