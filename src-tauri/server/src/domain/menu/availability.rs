//! Whether an item can be ordered now: its status, its category's status and its shifts, evaluated
//! in the store timezone (the same local-time rule as the inbox business hours).
use super::model::Shift;
use crate::domain::schedule::local_time;

/// Minutes since midnight of a valid "HH:MM" (00:00–23:59).
pub fn minutes(clock: &str) -> Option<i64> {
    let (hours, mins) = clock.split_once(':')?;
    if hours.len() != 2 || mins.len() != 2 {
        return None;
    }
    let (h, m) = (hours.parse::<i64>().ok()?, mins.parse::<i64>().ok()?);
    ((0..24).contains(&h) && (0..60).contains(&m)).then_some(h * 60 + m)
}

/// Whether one shift covers `day` (0 = Sunday) at `minute`. `start == end` means the whole day.
pub fn shift_covers(shift: &Shift, day: i64, minute: i64) -> bool {
    let (Some(start), Some(end)) = (minutes(&shift.start), minutes(&shift.end)) else {
        return false;
    };
    let today = shift.days.contains(&day);
    let yesterday = shift.days.contains(&((day + 6) % 7));
    if start == end {
        today
    } else if start < end {
        today && minute >= start && minute < end
    } else {
        (today && minute >= start) || (yesterday && minute < end)
    }
}

/// No shifts means always available.
pub fn open_now(shifts: &[Shift], epoch_seconds: i64, time_zone: &str) -> bool {
    if shifts.is_empty() {
        return true;
    }
    let (day, minute) = local_time(epoch_seconds, time_zone);
    shifts.iter().any(|s| shift_covers(s, day, minute))
}

pub fn available_now(
    item_status: &str,
    category_status: &str,
    shifts: &[Shift],
    epoch_seconds: i64,
    time_zone: &str,
) -> bool {
    item_status == "available" && category_status == "available" && open_now(shifts, epoch_seconds, time_zone)
}
