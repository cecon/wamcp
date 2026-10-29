//! The agentic engine: durable activities that AI agents work on, delegations between them, the tools
//! the engine serves them (deny by default) and the limits that keep runs from looping. The runtime
//! that drives the model is a port; nothing here depends on its format. See `docs/engine/spec.md`.
pub mod activity;
pub mod delegation;
pub mod grants;
pub mod model;
pub mod prompt;
pub mod tools;

/// Delegations allowed below a root activity (Lu → Anny is one hop).
pub const MAX_HOPS: i64 = 3;
/// Runs of one activity before it fails (the first one plus retries).
pub const MAX_ATTEMPTS: i64 = 3;
/// Default wall-clock limit of one run.
pub const RUN_TIMEOUT_SECS: i64 = 180;
/// The fixed notice a requester gets when an activity fails: never an invented result.
pub const FAILURE_NOTICE: &str = "Não consegui concluir este pedido agora. A equipe foi avisada e vai verificar.";

/// Whether the agent has used up its monthly token budget (`None` or 0 = no budget).
pub fn over_budget(used_tokens: i64, budget: Option<i64>) -> bool {
    matches!(budget, Some(limit) if limit > 0 && used_tokens >= limit)
}

/// Reference price used when a runtime does not report cost (USD per million tokens, versioned).
pub const PRICE_REFERENCE: &str = "ref-2026-10";
const INPUT_USD_PER_MTOK: f64 = 3.0;
const OUTPUT_USD_PER_MTOK: f64 = 15.0;
const CACHED_USD_PER_MTOK: f64 = 0.3;

/// Estimated cost of a run's tokens at the reference price.
pub fn estimate_cost(input: i64, output: i64, cached: i64) -> f64 {
    let per = |tokens: i64, price: f64| tokens.max(0) as f64 * price / 1_000_000.0;
    per(input, INPUT_USD_PER_MTOK) + per(output, OUTPUT_USD_PER_MTOK) + per(cached, CACHED_USD_PER_MTOK)
}
