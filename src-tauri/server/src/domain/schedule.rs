//! Chatwoot-style business hours evaluated in the inbox timezone.
use super::error::{fail, Result};
use super::model::{DaySchedule, Inbox, WorkingHour};
use chrono::{DateTime, Datelike, Timelike};
use chrono_tz::Tz;

fn zone(name: &str) -> Option<Tz> {
    Tz::from_str_insensitive(name).ok()
}

/// Weekday (0 = Sunday) and minute of the day of `epoch_seconds` in `time_zone` (UTC if unknown).
pub fn local_time(epoch_seconds: i64, time_zone: &str) -> (i64, i64) {
    let utc = DateTime::from_timestamp(epoch_seconds, 0).unwrap_or_default();
    let local = utc.with_timezone(&zone(time_zone).unwrap_or(Tz::UTC));
    (
        i64::from(local.weekday().num_days_from_sunday()),
        i64::from(local.hour() * 60 + local.minute()),
    )
}

/// Without working hours enabled the inbox is always open; a day without a row is closed.
pub fn is_open(inbox: &Inbox, schedule: &[WorkingHour], epoch_seconds: i64) -> bool {
    if inbox.working_hours_enabled == 0 {
        return true;
    }
    let (day, minutes) = local_time(epoch_seconds, &inbox.timezone);
    match schedule.iter().find(|d| d.day_of_week == day) {
        Some(today) if today.closed_all_day == 0 => minutes >= today.open_minutes && minutes < today.close_minutes,
        _ => false,
    }
}

pub fn validate_schedule(days: &[DaySchedule]) -> Result<()> {
    let mut seen = Vec::new();
    for d in days {
        if seen.contains(&d.day_of_week) {
            return fail("Dia da semana repetido");
        }
        seen.push(d.day_of_week);
        if !d.closed_all_day && d.open_minutes >= d.close_minutes {
            return fail("O horário de abertura precisa ser antes do fechamento");
        }
    }
    Ok(())
}

pub fn validate_timezone(time_zone: &str) -> Result<()> {
    match zone(time_zone) {
        Some(_) => Ok(()),
        None => fail("Fuso horário inválido"),
    }
}
