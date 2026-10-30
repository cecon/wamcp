/** A recurring job AI agents subscribe to (`/agent_schedules`); times are epoch milliseconds. */
export interface AgentSchedule {
  id: number;
  name: string;
  cron: string | null;
  interval_minutes: number | null;
  timezone: string;
  prompt: string;
  active: boolean;
  created_by: number | null;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  agent_ids: number[];
}

export type RunStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface ScheduleRun {
  id: number;
  schedule_id: number;
  agent_id: number;
  agent_name: string | null;
  status: RunStatus;
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface ScheduleDraft {
  name: string;
  cron: string | null;
  interval_minutes: number | null;
  timezone: string;
  prompt: string;
  active: boolean;
  agent_ids: number[];
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Ready-made schedules of the cron helper; `custom` edits the expression or interval by hand. */
export const PRESETS: { id: string; label: string; cron?: string; interval?: number }[] = [
  { id: '15min', label: 'A cada 15 minutos', interval: 15 },
  { id: 'hourly', label: 'A cada hora', cron: '0 * * * *' },
  { id: 'daily9', label: 'Todo dia às 9h', cron: '0 9 * * *' },
  { id: 'weekdays8', label: 'Dias úteis às 8h', cron: '0 8 * * 1-5' },
  { id: 'monday9', label: 'Toda segunda às 9h', cron: '0 9 * * 1' },
  { id: 'monthly', label: 'Todo dia 1º às 9h', cron: '0 9 1 * *' },
];

export const RUN_LABEL: Record<RunStatus, string> = {
  running: 'Executando',
  done: 'Concluída',
  failed: 'Falhou',
  skipped: 'Pulada',
};

/** How the schedule repeats, in words when it is a preset. */
export function describeWhen(s: Pick<AgentSchedule, 'cron' | 'interval_minutes'>): string {
  const preset = PRESETS.find((p) => (s.cron ? p.cron === s.cron : p.interval === s.interval_minutes));
  if (preset) return preset.label;
  if (s.interval_minutes) return `A cada ${s.interval_minutes} minutos`;
  return `Cron ${s.cron}`;
}

export function formatTime(ms: number | null, timeZone?: string): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
