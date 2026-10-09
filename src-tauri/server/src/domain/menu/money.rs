//! Money in integer cents: Brazilian formatting and conversion from the decimal reais of iFood.

/// `2990` → `R$ 29,90`; thousands use a dot (`R$ 1.234,50`).
pub fn brl(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let cents = cents.unsigned_abs();
    let whole = (cents / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!("{sign}R$ {grouped},{:02}", cents % 100)
}

/// Decimal reais (`29.9`) to cents (`2990`), rounded to the nearest cent; negatives become 0.
pub fn cents(reais: f64) -> i64 {
    if !reais.is_finite() || reais <= 0.0 {
        return 0;
    }
    (reais * 100.0).round() as i64
}

/// Division rounding up to the cent (pizza `average` pricing).
pub fn ceil_div(total: i64, parts: i64) -> i64 {
    if parts <= 0 {
        return total;
    }
    (total + parts - 1).div_euclid(parts)
}
