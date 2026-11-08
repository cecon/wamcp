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

/// Who asked for the run that calls the tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caller {
    pub coordinator: bool,
    /// The run answers a customer's message: its text may try to steer the agent.
    pub from_customer: bool,
}

/// `grant` is the effect granted to the agent for this tool (`None` = no grant).
pub fn decide(tool: &ToolDef, grant: Option<&str>, policy: &str, caller: Caller) -> Decision {
    // Delegating, concluding and memory belong to every agent; coordinators never do anything else.
    if tool.builtin {
        return Decision::Allow;
    }
    if caller.coordinator {
        return Decision::Deny(format!("Coordenadores não executam ferramentas ({})", tool.name));
    }
    if caller.from_customer && tool.internal_only {
        return Decision::Deny(format!("{} só roda em pedidos da equipe, não de clientes", tool.name));
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
    use crate::domain::engine::tools::{builtins, DELEGATE};

    fn tool(side_effects: bool, sensitive: bool, internal_only: bool) -> ToolDef {
        ToolDef {
            name: "financeiro.x".into(),
            description: String::new(),
            builtin: false,
            side_effects,
            sensitive,
            internal_only,
            contact_scoped: false,
            input_schema: serde_json::json!({}),
        }
    }

    const OPERATOR: Caller = Caller {
        coordinator: false,
        from_customer: false,
    };

    #[test]
    fn denies_without_grant_and_asks_for_sensitive() {
        let pay = tool(false, false, false);
        assert!(matches!(decide(&pay, None, WITHIN_GRANTS, OPERATOR), Decision::Deny(_)));
        assert_eq!(decide(&pay, Some(ALLOW), WITHIN_GRANTS, OPERATOR), Decision::Allow);
        assert_eq!(
            decide(&pay, Some(APPROVAL), WITHIN_GRANTS, OPERATOR),
            Decision::Approval
        );
        let coordinator = Caller {
            coordinator: true,
            ..OPERATOR
        };
        assert!(matches!(
            decide(&pay, Some(ALLOW), WITHIN_GRANTS, coordinator),
            Decision::Deny(_)
        ));
        let charge = tool(true, true, false);
        assert_eq!(
            decide(&charge, Some(ALLOW), APPROVAL_FOR_SENSITIVE, OPERATOR),
            Decision::Approval
        );
        assert_eq!(decide(&charge, Some(ALLOW), SUGGEST_ONLY, OPERATOR), Decision::Approval);
        assert_eq!(decide(&charge, Some(ALLOW), WITHIN_GRANTS, OPERATOR), Decision::Allow);
        let delegate = builtins().into_iter().find(|t| t.name == DELEGATE).unwrap();
        assert_eq!(decide(&delegate, None, SUGGEST_ONLY, coordinator), Decision::Allow);
    }

    #[test]
    fn internal_tools_never_run_for_a_customer_message() {
        let internal = tool(false, false, true);
        let customer = Caller {
            from_customer: true,
            ..OPERATOR
        };
        assert!(matches!(
            decide(&internal, Some(ALLOW), WITHIN_GRANTS, customer),
            Decision::Deny(_)
        ));
        assert_eq!(decide(&internal, Some(ALLOW), WITHIN_GRANTS, OPERATOR), Decision::Allow);
    }
}
