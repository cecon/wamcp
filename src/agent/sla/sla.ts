import type { SlaPolicy, SlaTarget } from '../parityTypes';
import { useFetch } from '../useFetch';

export type ThresholdUnit = 'minutes' | 'hours' | 'days';
export const UNIT_SECONDS: Record<ThresholdUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
export const UNIT_LABEL: Record<ThresholdUnit, string> = { minutes: 'Minutos', hours: 'Horas', days: 'Dias' };

export type ThresholdKey =
  'first_response_time_threshold' | 'next_response_time_threshold' | 'resolution_time_threshold';
export const THRESHOLDS: { key: ThresholdKey; target: SlaTarget; label: string }[] = [
  { key: 'first_response_time_threshold', target: 'first_response', label: 'Primeira resposta' },
  { key: 'next_response_time_threshold', target: 'next_response', label: 'Próxima resposta' },
  { key: 'resolution_time_threshold', target: 'resolution', label: 'Resolução' },
];

/** Seconds → the largest unit that divides them exactly ("" when not set). */
export function splitThreshold(seconds: number | null): { value: string; unit: ThresholdUnit } {
  if (!seconds) return { value: '', unit: 'hours' };
  const unit = (['days', 'hours', 'minutes'] as ThresholdUnit[]).find((u) => seconds % UNIT_SECONDS[u] === 0);
  return unit
    ? { value: String(seconds / UNIT_SECONDS[unit]), unit }
    : { value: String(Math.round(seconds / 60)), unit: 'minutes' };
}

/** Amount in a unit → seconds sent to the API (`null` when the target is empty). */
export function toSeconds(value: string, unit: ThresholdUnit) {
  const amount = Number(value);
  return value.trim() && amount > 0 ? Math.round(amount * UNIT_SECONDS[unit]) : null;
}

/** SLA policies (any agent may list them, to apply one to a conversation). */
export function useSlaPolicies(enabled = true) {
  const { data, error, reload } = useFetch<SlaPolicy[]>(enabled ? '/sla_policies' : null);
  return { policies: data || [], error, reload };
}
