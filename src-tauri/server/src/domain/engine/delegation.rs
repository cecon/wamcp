//! Rules of a delegation: a hop limit and no cycles (an agent already in the chain cannot get the work back).
use super::MAX_HOPS;
use crate::domain::error::{fail, Result};

/// `chain` holds the agents from the root activity down to the one delegating now.
pub fn check(chain: &[i64], to_agent: i64) -> Result<i64> {
    let hops = i64::try_from(chain.len()).unwrap_or(i64::MAX);
    if hops > MAX_HOPS {
        return fail(format!("Limite de {MAX_HOPS} delegações atingido"));
    }
    if chain.contains(&to_agent) {
        return fail("Delegação circular: esse agente já está na cadeia desta atividade");
    }
    Ok(hops)
}

/// Text normalised for idempotency keys: the same request delegated twice is one delegation.
pub fn request_key(skill: &str, request: &str) -> String {
    let words: Vec<String> = request.split_whitespace().map(str::to_lowercase).collect();
    format!("{}|{}", skill.trim().to_lowercase(), words.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_hops_and_blocks_cycles() {
        assert_eq!(check(&[1], 2).unwrap(), 1);
        assert_eq!(check(&[1, 2], 3).unwrap(), 2);
        assert!(check(&[1, 2], 1).is_err());
        assert!(check(&[1, 2, 3, 4], 5).is_err());
    }

    #[test]
    fn same_request_same_key() {
        assert_eq!(
            request_key("Consultar_Pagamento", "O cliente  ACME pagou?"),
            request_key("consultar_pagamento", "o cliente acme pagou?")
        );
    }
}
