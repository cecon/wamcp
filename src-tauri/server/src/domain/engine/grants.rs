//! Whether an agent may call a tool: deny by default, then the grant and the agent's execution policy.
use super::tools::ToolDef;

pub const ALLOW: &str = "allow";
pub const APPROVAL: &str = "approval";
pub const EFFECTS: [&str; 2] = [ALLOW, APPROVAL];

pub const SUGGEST_ONLY: &str = "suggest_only";
pub const APPROVAL_FOR_SENSITIVE: &str = "approval_for_sensitive";
pub const WITHIN_GRANTS: &str = "within_grants";
pub const POLICIES: [&str; 3] = [SUGGEST_ONLY, APPROVAL_FOR_SENSITIVE, WITHIN_GRANTS];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// A person must approve before the tool runs.
    Approval,
    Deny(String),
}

/// `grant` is the effect granted to the agent for this tool (`None` = no grant).
pub fn decide(tool: &ToolDef, grant: Option<&str>, policy: &str, coordinator: bool) -> Decision {
    // Delegating, concluding and memory belong to every agent; coordinators never do anything else.
    if tool.builtin {
        return Decision::Allow;
    }
    if coordinator {
        return Decision::Deny(format!("Coordenadores não executam ferramentas ({})", tool.name));
    }
    let Some(effect) = grant else {
        return Decision::Deny(format!("Sem permissão para {}", tool.name));
    };
    let needs_approval = effect == APPROVAL
        || (policy == SUGGEST_ONLY && tool.side_effects)
        || (policy == APPROVAL_FOR_SENSITIVE && tool.sensitive);
    if needs_approval {
        Decision::Approval
    } else {
        Decision::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::engine::tools::find;

    #[test]
    fn denies_without_grant_and_asks_for_sensitive() {
        let pay = find("financeiro.consultar_pagamento").unwrap();
        assert!(matches!(decide(pay, None, WITHIN_GRANTS, false), Decision::Deny(_)));
        assert_eq!(decide(pay, Some(ALLOW), WITHIN_GRANTS, false), Decision::Allow);
        assert_eq!(decide(pay, Some(APPROVAL), WITHIN_GRANTS, false), Decision::Approval);
        assert!(matches!(
            decide(pay, Some(ALLOW), WITHIN_GRANTS, true),
            Decision::Deny(_)
        ));
        let charge = find("financeiro.registrar_cobranca").unwrap();
        assert_eq!(
            decide(charge, Some(ALLOW), APPROVAL_FOR_SENSITIVE, false),
            Decision::Approval
        );
        assert_eq!(decide(charge, Some(ALLOW), SUGGEST_ONLY, false), Decision::Approval);
        assert_eq!(decide(charge, Some(ALLOW), WITHIN_GRANTS, false), Decision::Allow);
        let delegate = find("delegar").unwrap();
        assert_eq!(decide(delegate, None, SUGGEST_ONLY, true), Decision::Allow);
    }
}
