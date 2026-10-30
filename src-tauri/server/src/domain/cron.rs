//! Five-field cron expressions (`minuto hora dia-do-mês mês dia-da-semana`), evaluated in a time
//! zone: `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/15`, `8-18/2`); Sunday is 0 or 7. As in
//! Vixie cron, when both the day of the month and the day of the week are restricted, either matches.
use super::error::{fail, Result};
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, TimeZone};
use chrono_tz::Tz;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cron {
    minutes: Vec<u32>,
    hours: Vec<u32>,
    days: Vec<u32>,
    months: Vec<u32>,
    weekdays: Vec<u32>,
    any_day: bool,
    any_weekday: bool,
}

/// How far ahead a match is searched (an expression like `0 0 30 2 *` never matches).
const HORIZON_DAYS: i64 = 366 * 5;

fn field(text: &str, min: u32, max: u32, name: &str) -> Result<Vec<u32>> {
    let invalid = || fail(format!("Campo de {name} inválido na expressão cron: {text}"));
    let mut values = Vec::new();
    for part in text.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => match step.parse::<u32>() {
                Ok(step) if step > 0 => (range, step),
                _ => return invalid(),
            },
            None => (part, 1),
        };
        let (from, to) = if range == "*" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            match (a.parse::<u32>(), b.parse::<u32>()) {
                (Ok(a), Ok(b)) => (a, b),
                _ => return invalid(),
            }
        } else {
            match range.parse::<u32>() {
                // `5/10` means from 5 to the end, every 10.
                Ok(a) if part.contains('/') => (a, max),
                Ok(a) => (a, a),
                Err(_) => return invalid(),
            }
        };
        if from < min || to > max || from > to {
            return invalid();
        }
        values.extend((from..=to).step_by(step as usize));
    }
    values.sort_unstable();
    values.dedup();
    Ok(values)
}

impl Cron {
    pub fn parse(expression: &str) -> Result<Self> {
        let parts: Vec<&str> = expression.split_whitespace().collect();
        let [minute, hour, day, month, weekday] = parts[..] else {
            return fail("A expressão cron precisa de 5 campos: minuto hora dia mês dia-da-semana");
        };
        let mut weekdays: Vec<u32> = field(weekday, 0, 7, "dia da semana")?
            .into_iter()
            .map(|d| d % 7)
            .collect();
        weekdays.sort_unstable();
        weekdays.dedup();
        Ok(Self {
            minutes: field(minute, 0, 59, "minuto")?,
            hours: field(hour, 0, 23, "hora")?,
            days: field(day, 1, 31, "dia do mês")?,
            months: field(month, 1, 12, "mês")?,
            weekdays,
            any_day: day == "*",
            any_weekday: weekday == "*",
        })
    }

    fn matches_day(&self, date: NaiveDate) -> bool {
        if !self.months.contains(&date.month()) {
            return false;
        }
        let day = self.days.contains(&date.day());
        let weekday = self.weekdays.contains(&date.weekday().num_days_from_sunday());
        match (self.any_day, self.any_weekday) {
            (true, true) => true,
            (false, true) => day,
            (true, false) => weekday,
            (false, false) => day || weekday,
        }
    }

    /// The first matching minute strictly after `after` (epoch seconds), as epoch seconds. A local
    /// time skipped by daylight saving does not happen that day; a repeated one runs once.
    pub fn next_after(&self, after: i64, zone: Tz) -> Option<i64> {
        let start = DateTime::from_timestamp(after, 0)?.with_timezone(&zone).date_naive();
        (0..HORIZON_DAYS)
            .map(|offset| start + Duration::days(offset))
            .filter(|date| self.matches_day(*date))
            .find_map(|date| {
                self.hours.iter().find_map(|hour| {
                    self.minutes.iter().find_map(|minute| {
                        let local = date.and_hms_opt(*hour, *minute, 0)?;
                        let at = match zone.from_local_datetime(&local) {
                            LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t.timestamp(),
                            LocalResult::None => return None,
                        };
                        (at > after).then_some(at)
                    })
                })
            })
    }
}

/// The time zone by its IANA name, or an error for the person.
pub fn zone(name: &str) -> Result<Tz> {
    Tz::from_str_insensitive(name.trim()).or_else(|_| fail("Fuso horário inválido"))
}
