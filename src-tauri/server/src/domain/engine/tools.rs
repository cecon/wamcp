//! The tools the engine serves to agents. Built-in tools belong to every run; the others come
//! from the installed plugins and need a grant.
use crate::domain::plugins::{Manifest, PluginTool};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    /// Every run has it (delegate, conclude, memory); no grant needed.
    pub builtin: bool,
    /// Changes something outside the engine (a charge, a message): needs approval under `suggest_only`.
    pub side_effects: bool,
    /// Needs approval under `approval_for_sensitive`.
    pub sensitive: bool,
    /// Never offered to a run that answers a customer's message.
    pub internal_only: bool,
    /// Gets the turn's real contact in `contato` when a customer's message started the turn.
    pub contact_scoped: bool,
    /// JSON Schema of the arguments (MCP `inputSchema`).
    pub input_schema: Value,
}

pub const DELEGATE: &str = "delegar";
pub const CONCLUDE: &str = "concluir";
pub const REMEMBER: &str = "memoria.lembrar";
pub const RECALL: &str = "memoria.consultar";

fn builtin(name: &str, description: &str, props: Value, required: &[&str]) -> ToolDef {
    ToolDef {
        name: name.into(),
        description: description.into(),
        builtin: true,
        side_effects: false,
        sensitive: false,
        internal_only: false,
        contact_scoped: false,
        input_schema: json!({"type": "object", "properties": props, "required": required}),
    }
}

/// Delegating, concluding and memory: every run has them.
pub fn builtins() -> Vec<ToolDef> {
    vec![
        builtin(
            DELEGATE,
            "Delega um pedido ao agente da organização que tem a skill indicada e devolve a resposta dele.",
            json!({"skill": {"type": "string"}, "pedido": {"type": "string"}, "motivo": {"type": "string"}}),
            &["skill", "pedido"],
        ),
        builtin(
            CONCLUDE,
            "Conclui a atividade com a resposta final, citando os ids das evidências usadas.",
            json!({"resposta": {"type": "string"}, "evidencias": {"type": "array", "items": {"type": "string"}}}),
            &["resposta"],
        ),
        builtin(
            REMEMBER,
            "Guarda uma memória do agente (episódica, semântica ou operacional).",
            json!({"conteudo": {"type": "string"},
                   "tipo": {"enum": ["episodic", "semantic", "operational"]},
                   "escopo": {"enum": ["private", "organization"]}}),
            &["conteudo"],
        ),
        builtin(
            RECALL,
            "Consulta as memórias visíveis para o agente.",
            json!({"termo": {"type": "string"}}),
            &[],
        ),
    ]
}

/// A plugin tool as the engine sees it.
pub fn from_plugin(manifest: &Manifest, tool: &PluginTool) -> ToolDef {
    ToolDef {
        name: manifest.tool_name(tool),
        description: tool.description.clone(),
        builtin: false,
        side_effects: tool.side_effects,
        sensitive: tool.sensitive,
        internal_only: tool.internal_only,
        contact_scoped: tool.contact_scoped,
        input_schema: tool.input_schema.clone(),
    }
}

/// A required string argument, trimmed and non-empty.
pub fn text_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
