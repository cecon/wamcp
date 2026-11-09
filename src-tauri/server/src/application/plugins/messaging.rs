//! The "Mensagens" plugin that ships with the app: lets an agent write first to a contact on
//! WhatsApp (a reminder, a request for documents). The tool is internal-only (never offered when a
//! customer's message started the turn) and sensitive, so under the default policy every message
//! waits for a person's approval. The conversation it starts is `open`: the reply goes to people.
use crate::application::helpdesk::HelpdeskService;
use crate::application::ports::BusinessTools;
use crate::domain::actor::Actor;
use crate::domain::contacts::normalize_phone;
use crate::domain::engine::tools::text_arg;
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub const SEND: &str = "enviar_whatsapp";

pub fn manifest() -> Value {
    json!({
        "id": "mensagens", "name": "Mensagens", "version": "1.0.0",
        "description": "O agente escreve primeiro para um contato no WhatsApp. Cada envio pede a aprovação de uma pessoa.",
        "tools": [{
            "name": SEND,
            "description": "Envia uma mensagem de WhatsApp para um contato pelo telefone (cria o contato e a conversa se preciso). A resposta do contato vai para as pessoas da caixa.",
            "input_schema": {"type": "object", "required": ["telefone", "mensagem"], "properties": {
                "telefone": {"type": "string", "description": "Formato internacional, ex. +5511988887777"},
                "mensagem": {"type": "string"},
                "nome": {"type": "string", "description": "Nome do contato, se ele ainda não existir"}}},
            "side_effects": true, "sensitive": true, "internal_only": true,
            "endpoint": {"kind": "builtin"}
        }]
    })
}

pub struct MessagingTools(pub HelpdeskService);

#[async_trait]
impl BusinessTools for MessagingTools {
    async fn call(&self, _account_id: i64, tool: &str, args: &Value) -> Result<Value> {
        if tool != SEND {
            return fail(format!("Ferramenta desconhecida: {tool}"));
        }
        let (Some(phone), Some(message)) = (text_arg(args, "telefone"), text_arg(args, "mensagem")) else {
            return fail("Informe `telefone` e `mensagem`");
        };
        if message.chars().count() > 4000 {
            return fail("Mensagem longa demais (até 4000 caracteres)");
        }
        let phone = normalize_phone(&phone)?;
        let repo = &self.0.core.repo;
        let inbox = repo.inboxes(None)?.into_iter().find(|i| i.channel_type == "whatsapp");
        let Some(inbox) = inbox else {
            return fail("Não há caixa de WhatsApp para enviar");
        };
        let contact = match repo.contact_by_phone(&phone)? {
            Some(contact) => contact,
            None => repo.create_contact(text_arg(args, "nome").as_deref(), Some(&phone))?,
        };
        let actor = Actor::System {
            kind: "agent".into(),
            name: "Agente de IA".into(),
        };
        let conversation = self
            .0
            .start_conversation(&actor, contact.id, inbox.id, Some(message))
            .await?;
        Ok(json!({"enviado": true, "conversa": conversation.display_id, "telefone": phone}))
    }
}
