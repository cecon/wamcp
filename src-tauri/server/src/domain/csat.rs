//! CSAT over WhatsApp: the survey asks for a 1–5 reply, and the answer is accepted for 24 hours.
use super::model::Conversation;
use regex::Regex;
use std::sync::LazyLock;

pub const CSAT_WINDOW_SECONDS: i64 = 24 * 3600;
pub const CSAT_SURVEY: &str = "Como você avalia nosso atendimento? Responda com uma nota de 1 (ruim) a 5 (excelente).";
pub const CSAT_THANKS: &str = "Obrigado pela avaliação!";

static RATING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)^\s*(?:nota\s*)?([1-5])(?:\s*(?:[-–:,.!]\s*)?(.*))?$").expect("valid regex"));

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rating {
    pub rating: i64,
    pub feedback: Option<String>,
}

/// Accepts "5", "nota 4", "4 - foi ótimo"; returns the rating and optional feedback.
pub fn parse_rating(text: &str) -> Option<Rating> {
    let captures = RATING.captures(text)?;
    let rating = captures[1].parse().ok()?;
    let feedback = captures
        .get(2)
        .map(|m| m.as_str().trim().to_string())
        .filter(|f| !f.is_empty());
    Some(Rating { rating, feedback })
}

/// A resolved conversation whose survey is still open captures the reply instead of reopening.
pub fn awaiting_csat(conversation: Option<&Conversation>, now: i64) -> bool {
    conversation.is_some_and(|c| {
        c.status == "resolved"
            && c.csat_requested_at
                .is_some_and(|at| at != 0 && now - at <= CSAT_WINDOW_SECONDS)
    })
}
