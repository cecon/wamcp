//! The tools the engine serves to agents. Built-in tools belong to every run; the others need a grant.
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    /// Every run has it (delegate, conclude, memory); no grant needed.
    pub builtin: bool,
    /// Changes something outside the engine (a charge, a message): needs approval under `suggest_only`.
    pub side_effects: bool,
    /// Needs approval under `approval_for_sensitive`.
    pub sensitive: bool,
}

pub const DELEGATE: &str = "delegar";
pub const CONCLUDE: &str = "concluir";
pub const REMEMBER: &str = "memoria.lembrar";
pub const RECALL: &str = "memoria.consultar";
pub const CHECK_PAYMENT: &str = "financeiro.consultar_pagamento";
pub const REGISTER_CHARGE: &str = "financeiro.registrar_cobranca";

const fn builtin(name: &'static str, description: &'static str) -> ToolDef {
    ToolDef {
        name,
        description,
        builtin: true,
        side_effects: false,
        sensitive: false,
    }
}

pub const TOOLS: [ToolDef; 6] = [
    builtin(
        DELEGATE,
        "Delega um pedido ao agente da organização que tem a skill indicada e devolve a resposta dele.",
    ),
    builtin(
        CONCLUDE,
        "Conclui a atividade com a resposta final, citando os ids das evidências usadas.",
    ),
    builtin(
        REMEMBER,
        "Guarda uma memória do agente (episódica, semântica ou operacional).",
    ),
    builtin(RECALL, "Consulta as memórias visíveis para o agente."),
    ToolDef {
        name: CHECK_PAYMENT,
        description: "Consulta se um cliente pagou: status, valor e data do pagamento (dados fictícios).",
        builtin: false,
        side_effects: false,
        sensitive: false,
    },
    ToolDef {
        name: REGISTER_CHARGE,
        description: "Registra uma cobrança para um cliente (simulada).",
        builtin: false,
        side_effects: true,
        sensitive: true,
    },
];

pub fn find(name: &str) -> Option<&'static ToolDef> {
    TOOLS.iter().find(|tool| tool.name == name)
}

/// JSON Schema of each tool's arguments (MCP `inputSchema`).
pub fn input_schema(name: &str) -> Value {
    let (props, required): (Value, &[&str]) = match name {
        DELEGATE => (
            json!({"skill": {"type": "string"}, "pedido": {"type": "string"}, "motivo": {"type": "string"}}),
            &["skill", "pedido"],
        ),
        CONCLUDE => (
            json!({"resposta": {"type": "string"},
                   "evidencias": {"type": "array", "items": {"type": "string"}}}),
            &["resposta"],
        ),
        REMEMBER => (
            json!({"conteudo": {"type": "string"},
                   "tipo": {"enum": ["episodic", "semantic", "operational"]},
                   "escopo": {"enum": ["private", "organization"]}}),
            &["conteudo"],
        ),
        RECALL => (json!({"termo": {"type": "string"}}), &[]),
        CHECK_PAYMENT => (json!({"cliente": {"type": "string"}}), &["cliente"]),
        REGISTER_CHARGE => (
            json!({"cliente": {"type": "string"}, "valor": {"type": "number"}}),
            &["cliente", "valor"],
        ),
        _ => (json!({}), &[]),
    };
    json!({"type": "object", "properties": props, "required": required})
}

/// A required string argument, trimmed and non-empty.
pub fn text_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
