import type { MetricKey } from '../parityTypes';

/** The six Chatwoot report metrics; `time` ones are averages in seconds (lower is better). */
export const METRICS: { key: MetricKey; label: string; time?: boolean }[] = [
  { key: 'conversations_count', label: 'Conversas' },
  { key: 'incoming_messages_count', label: 'Mensagens recebidas' },
  { key: 'outgoing_messages_count', label: 'Mensagens enviadas' },
  { key: 'avg_first_response_time', label: 'Tempo da primeira resposta', time: true },
  { key: 'avg_resolution_time', label: 'Tempo de resolução', time: true },
  { key: 'resolutions_count', label: 'Resoluções' },
];

export const isTimeMetric = (key: MetricKey) => Boolean(METRICS.find((m) => m.key === key)?.time);

/** Seconds → "45s", "2min 5s", "1h 2min", "2d 3h" (two units at most); empty averages show "—". */
export function formatSeconds(seconds: number | null | undefined) {
  if (!seconds) return '—';
  const s = Math.round(seconds);
  const units: [number, string][] = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'min'],
    [1, 's'],
  ];
  const parts: string[] = [];
  let rest = s;
  for (const [size, unit] of units) {
    const amount = Math.floor(rest / size);
    rest -= amount * size;
    if (amount) parts.push(`${amount}${unit}`);
    else if (parts.length) break;
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}

export const formatNumber = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export const formatMetric = (key: MetricKey, value: number | null | undefined) =>
  isTimeMetric(key) ? formatSeconds(value) : formatNumber(value);

export const formatPercent = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Percent change from the previous period (`null` when there is nothing to compare with). */
export function trend(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
