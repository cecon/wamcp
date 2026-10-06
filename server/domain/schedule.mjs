import { HelpdeskError } from './helpdesk.mjs';

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) and minute of the day of `epochSeconds` in the inbox timezone. */
export function localTime(epochSeconds, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(epochSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  return { day: WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * Chatwoot-style business hours. Without working hours enabled the inbox is always open;
 * a day without a row is treated as closed.
 */
export function isOpen(inbox, schedule, epochSeconds) {
  if (!inbox.working_hours_enabled) return true;
  const { day, minutes } = localTime(epochSeconds, inbox.timezone);
  const today = schedule.find((d) => d.day_of_week === day);
  if (!today || today.closed_all_day) return false;
  return minutes >= today.open_minutes && minutes < today.close_minutes;
}

export function validateSchedule(days) {
  const seen = new Set();
  for (const d of days) {
    if (seen.has(d.day_of_week)) throw new HelpdeskError('Dia da semana repetido');
    seen.add(d.day_of_week);
    if (!d.closed_all_day && d.open_minutes >= d.close_minutes)
      throw new HelpdeskError('O horário de abertura precisa ser antes do fechamento');
  }
}

export function validateTimezone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new HelpdeskError('Fuso horário inválido');
  }
}
