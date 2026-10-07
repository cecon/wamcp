//! Contact book rules: phone numbers, WhatsApp JIDs and the CSV import/export format.
use super::error::{fail, Result};
use super::model::Contact;

pub const CSV_HEADER: [&str; 5] = ["name", "phone_number", "email", "identifier", "labels"];

/// `+55 (11) 98888-7777` → `+5511988887777` (E.164 digits, 8 to 15 of them).
pub fn normalize_phone(raw: &str) -> Result<String> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    let allowed = raw.chars().all(|c| c.is_ascii_digit() || " +-().".contains(c));
    if !allowed || !(8..=15).contains(&digits.len()) {
        return fail("Telefone inválido: use o formato internacional, ex. +5511988887777");
    }
    Ok(format!("+{digits}"))
}

/// The WhatsApp JID of a normalised phone number.
pub fn phone_jid(phone: &str) -> String {
    format!("{}@s.whatsapp.net", phone.trim_start_matches('+'))
}

/// Splits CSV text into rows (RFC 4180 quotes, `,` or `;` separators); blank lines are kept.
pub fn parse_csv(input: &str) -> Vec<Vec<String>> {
    let separator = match input.lines().next() {
        Some(header) if header.matches(';').count() > header.matches(',').count() => ';',
        _ => ',',
    };
    let (mut rows, mut row, mut field) = (Vec::new(), Vec::new(), String::new());
    let mut chars = input.trim_start_matches('\u{feff}').chars().peekable();
    let mut quoted = false;
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            ('"', _) => quoted = !quoted,
            (c, false) if c == separator => row.push(std::mem::take(&mut field)),
            ('\r', false) => {}
            ('\n', false) => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            (c, _) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

fn escape(field: &str) -> String {
    // A leading = + - @ would run as a formula in spreadsheets.
    let field = if field.starts_with(['=', '+', '-', '@']) && !field[1..].chars().all(|c| c.is_ascii_digit()) {
        format!("'{field}")
    } else {
        field.to_string()
    };
    if field.contains([',', ';', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field
    }
}

/// One CSV line per contact, in [`CSV_HEADER`] order.
pub fn csv_line(contact: &Contact) -> String {
    let fields = [
        contact.name.clone().unwrap_or_default(),
        contact.phone_number.clone().unwrap_or_default(),
        contact.email.clone().unwrap_or_default(),
        contact.identifier.clone().unwrap_or_default(),
        contact.labels.join("|"),
    ];
    fields.iter().map(|f| escape(f)).collect::<Vec<_>>().join(",")
}
