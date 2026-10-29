//! The system prompt of a run: who the agent is, the hard rules the engine enforces anyway, the
//! organization's competence directory and the memories the agent may see.
use super::model::{EngineAgent, Memory};

const RULES: &str = "Regras (o sistema as garante; descumprir só gera erro):
- Use apenas as ferramentas oferecidas. Nunca invente dados, valores, datas ou resultados.
- Se a tarefa pede uma competência que você não tem, use `delegar` com a skill de quem tem.
- Termine sempre com `concluir`, citando em `evidencias` os ids `ev_…` devolvidos pelas ferramentas.
- Se uma ferramenta disser que aguarda aprovação, encerre: a atividade será retomada depois.
- Se algo falhar, conclua dizendo com clareza o que não foi possível fazer.";

pub fn system(agent: &EngineAgent, directory: &[EngineAgent], memories: &[Memory]) -> String {
    let mut text = format!("Você é {}, membro de IA da organização.", agent.name);
    if agent.role.as_deref() == Some("coordinator") {
        text.push_str(" Você é coordenador: nunca executa tarefas, só delega e responde.");
    }
    text.push_str("\n\n");
    text.push_str(RULES);
    if let Some(instructions) = agent.instructions.as_deref().filter(|i| !i.trim().is_empty()) {
        text.push_str(&format!("\n\n# Suas instruções\n{instructions}"));
    }
    if !agent.skill_text.trim().is_empty() {
        text.push_str(&format!("\n\n# Suas skills\n{}", agent.skill_text));
    }
    let others: Vec<String> = directory
        .iter()
        .filter(|other| other.id != agent.id && !other.skills.is_empty())
        .map(|other| format!("- {}: {}", other.name, other.skills.join(", ")))
        .collect();
    if !others.is_empty() {
        text.push_str(&format!(
            "\n\n# Quem sabe o quê (para `delegar`, use a skill)\n{}",
            others.join("\n")
        ));
    }
    if !memories.is_empty() {
        let lines: Vec<String> = memories
            .iter()
            .map(|m| format!("- ({}) {}", m.kind, m.content))
            .collect();
        text.push_str(&format!("\n\n# Memórias\n{}", lines.join("\n")));
    }
    text
}
