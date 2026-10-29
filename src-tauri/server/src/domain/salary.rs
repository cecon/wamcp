//! "Salário digital" of the organization's members: a person is a fixed seat; an AI agent starts the
//! month at zero and earns the token cost of its calls plus the margin, as the calls happen. Also the
//! organization rules of the panel: the hierarchy (who answers to whom) and the avatar choices.
use super::error::{fail, Result};
use super::model::{RosterAgent, Salary, UsageTotal};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Map, Value};

/// Hypothesis of the vision doc (Oct 2026): R$ 50 a month per person.
pub const DEFAULT_SEAT_BRL: f64 = 50.0;
/// Margin on top of an AI agent's token cost.
pub const DEFAULT_MARGIN_PERCENT: f64 = 50.0;
/// Dollars to reais for token costs, until the account sets its own rate.
pub const DEFAULT_USD_BRL: f64 = 5.5;

/// Account settings keys of the rates.
pub const SEAT_KEY: &str = "seat_price_brl";
pub const MARGIN_KEY: &str = "ai_margin_percent";
pub const RATE_KEY: &str = "usd_brl_rate";

/// How salaries are computed; stored in the account settings.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct SalaryRates {
    pub seat_price_brl: f64,
    pub ai_margin_percent: f64,
    pub usd_brl_rate: f64,
}

impl SalaryRates {
    /// The account's rates, each falling back to its default.
    pub fn from_settings(settings: &Value) -> Self {
        let get = |key: &str, default: f64| settings[key].as_f64().filter(|v| *v >= 0.0).unwrap_or(default);
        Self {
            seat_price_brl: get(SEAT_KEY, DEFAULT_SEAT_BRL),
            ai_margin_percent: get(MARGIN_KEY, DEFAULT_MARGIN_PERCENT),
            usd_brl_rate: get(RATE_KEY, DEFAULT_USD_BRL),
        }
    }

    /// What a dollar of tokens costs the company in reais, margin included.
    pub fn ai_brl_per_usd(&self) -> f64 {
        self.usd_brl_rate * (1.0 + self.ai_margin_percent / 100.0)
    }
}

fn cents(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// A member's salary for the month: an active person costs the seat; an AI agent its token cost
/// with the margin (zero until it works). Inactive people cost nothing.
pub fn salary(agent: &RosterAgent, usage: Option<&UsageTotal>, rates: &SalaryRates) -> Salary {
    let usage = usage.cloned().unwrap_or_default();
    let salary_brl = match agent.kind.as_str() {
        "ai" => cents(usage.cost_usd * rates.ai_brl_per_usd()),
        _ if agent.active => rates.seat_price_brl,
        _ => 0.0,
    };
    Salary {
        agent_id: agent.id,
        kind: agent.kind.clone(),
        salary_brl,
        calls: usage.calls,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: usage.cost_usd,
        unpriced_calls: usage.unpriced_calls,
    }
}

/// The `[from, to)` ISO bounds (UTC) of a `YYYY-MM` month.
pub fn month_bounds(month: &str) -> Result<(String, String)> {
    let Ok(first) = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d") else {
        return fail("Mês inválido: use AAAA-MM");
    };
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    };
    let next = next.unwrap_or(first);
    Ok((format!("{first}T00:00:00.000Z"), format!("{next}T00:00:00.000Z")))
}

/// Who an agent answers to must be another member, and the chain may never loop back to it.
pub fn check_supervisor(agent_id: i64, supervisor_id: Option<i64>, roster: &[RosterAgent]) -> Result<()> {
    let Some(first) = supervisor_id else {
        return Ok(());
    };
    if first == agent_id {
        return fail("Um agente não pode responder a si mesmo");
    }
    if !roster.iter().any(|a| a.id == first) {
        return fail("Superior não encontrado");
    }
    let mut current = Some(first);
    for _ in 0..roster.len() {
        let Some(id) = current else {
            return Ok(());
        };
        if id == agent_id {
            return fail("Essa escolha cria um ciclo na hierarquia");
        }
        current = roster.iter().find(|a| a.id == id).and_then(|a| a.supervisor_id);
    }
    Ok(())
}

/// Avatar parts and the choices of each; the first is the default.
pub const AVATAR_PARTS: [(&str, &[&str]); 5] = [
    ("skin", &["light", "tan", "brown", "dark"]),
    ("hair", &["short", "long", "curly", "bun", "none"]),
    ("outfit", &["shirt", "hoodie", "suit", "tshirt"]),
    ("accessory", &["none", "glasses", "headset", "cap"]),
    ("color", &["teal", "blue", "violet", "amber", "ruby", "iris"]),
];

/// Keeps the known parts with valid choices; anything else is refused.
pub fn validate_avatar(avatar: &Value) -> Result<Value> {
    let Some(fields) = avatar.as_object() else {
        return fail("Avatar inválido");
    };
    let mut clean = Map::new();
    for (key, value) in fields {
        let Some((_, choices)) = AVATAR_PARTS.iter().find(|(part, _)| part == key) else {
            return fail(format!("Parte do avatar desconhecida: {key}"));
        };
        match value.as_str() {
            Some(choice) if choices.contains(&choice) => {
                clean.insert(key.clone(), json!(choice));
            }
            _ => return fail(format!("Opção inválida para {key}")),
        }
    }
    Ok(Value::Object(clean))
}

/// Salaries of every member for a month, with the rates used.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SalarySheet {
    /// `YYYY-MM`.
    pub month: String,
    pub rates: SalaryRates,
    pub salaries: Vec<Salary>,
}

/// The `YYYY-MM` month of an instant (UTC).
pub fn current_month(epoch_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(epoch_ms)
        .unwrap_or_default()
        .format("%Y-%m")
        .to_string()
}

/// Midnight (UTC, ISO) of the day `days - 1` days before the instant: the start of a `days`-day window.
pub fn window_start(epoch_ms: i64, days: i64) -> String {
    const DAY_MS: i64 = 86_400_000;
    let start = epoch_ms - (days.clamp(1, 366) - 1) * DAY_MS;
    chrono::DateTime::from_timestamp_millis(start)
        .unwrap_or_default()
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string()
}
