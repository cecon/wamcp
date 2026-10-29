import { useEffect, useState } from 'react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { ModalFooter, Toggle } from '../../ui/Settings';
import { DEFAULT_TIMEZONE, PRESETS, formatTime, type AgentSchedule, type ScheduleDraft } from './types';

interface Props {
  schedule?: AgentSchedule;
  /** AI agents that may subscribe (never the system agent). */
  agents: RosterAgent[];
  busy: boolean;
  error: string;
  onSave: (draft: ScheduleDraft) => void;
  onCancel: () => void;
}

const presetOf = (d: ScheduleDraft) =>
  PRESETS.find((p) => (d.cron ? p.cron === d.cron : p.interval === d.interval_minutes))?.id ?? 'custom';

/** Next runs of the rule being edited, asked to the server (it knows the cron rules and time zones). */
function useUpcoming(draft: ScheduleDraft) {
  const [state, setState] = useState<{ times: number[]; error: string }>({ times: [], error: '' });
  const { cron, interval_minutes, timezone } = draft;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      http<number[]>('/agent_schedules/preview', 'POST', { cron, interval_minutes, timezone })
        .then((times) => live && setState({ times, error: '' }))
        .catch((e: Error) => live && setState({ times: [], error: e.message }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cron, interval_minutes, timezone]);
  return state;
}

/** Name, when it runs (presets or a cron expression / interval), the task and the subscribed agents. */
export function ScheduleEditor({ schedule, agents, busy, error, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ScheduleDraft>({
    name: schedule?.name ?? '',
    cron: schedule ? schedule.cron : '0 9 * * *',
    interval_minutes: schedule?.interval_minutes ?? null,
    timezone: schedule?.timezone ?? DEFAULT_TIMEZONE,
    prompt: schedule?.prompt ?? '',
    active: schedule?.active ?? true,
    agent_ids: schedule?.agent_ids ?? [],
  });
  const [custom, setCustom] = useState(() => presetOf(draft) === 'custom');
  const upcoming = useUpcoming(draft);
  const set = (patch: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const pick = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    setCustom(!preset);
    if (preset) set({ cron: preset.cron ?? null, interval_minutes: preset.interval ?? null });
  };
  const toggleAgent = (id: number, on: boolean) =>
    set({ agent_ids: on ? [...draft.agent_ids, id] : draft.agent_ids.filter((a) => a !== id) });
  const byInterval = draft.interval_minutes !== null;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <label>
        <span className="field-label">Nome</span>
        <input
          className="field"
          value={draft.name}
          maxLength={80}
          required
          placeholder="Ex.: Resumo das pendências"
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        <span className="field-label">Quando</span>
        <select
          className="field"
          value={custom ? 'custom' : presetOf(draft)}
          onChange={(e) => pick(e.target.value)}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      {custom && (
        <div className="flex flex-col gap-3 rounded-xl p-3 outline outline-1 -outline-offset-1 outline-n-weak">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="schedule-kind"
                checked={!byInterval}
                onChange={() => set({ cron: draft.cron || '0 9 * * *', interval_minutes: null })}
              />
              Por expressão cron
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="schedule-kind"
                checked={byInterval}
                onChange={() => set({ cron: null, interval_minutes: draft.interval_minutes || 30 })}
              />
              Por intervalo
            </label>
          </div>
          {byInterval ? (
            <label>
              <span className="field-label">A cada quantos minutos</span>
              <input
                className="field"
                type="number"
                min={1}
                max={10080}
                value={draft.interval_minutes ?? ''}
                onChange={(e) => set({ interval_minutes: Number(e.target.value) || null })}
              />
            </label>
          ) : (
            <div>
              <label>
                <span className="field-label">Expressão cron</span>
                <input
                  className="field font-mono"
                  value={draft.cron ?? ''}
                  placeholder="minuto hora dia mês dia-da-semana"
                  onChange={(e) => set({ cron: e.target.value })}
                />
              </label>
              <span className="mt-1 block text-xs text-n-slate-11">
                Ex.: <code>*/30 8-18 * * 1-5</code> = a cada 30 minutos, das 8h às 18h, de segunda a sexta.
              </span>
            </div>
          )}
          <label>
            <span className="field-label">Fuso horário</span>
            <input
              className="field"
              value={draft.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
            />
          </label>
        </div>
      )}
      <div className="text-xs text-n-slate-11" aria-live="polite">
        {upcoming.error ? (
          <span className="text-n-ruby-11">{upcoming.error}</span>
        ) : (
          upcoming.times.length > 0 && (
            <span>
              Próximas execuções: {upcoming.times.map((t) => formatTime(t, draft.timezone)).join(' · ')}
            </span>
          )
        )}
      </div>
      <label>
        <span className="field-label">Tarefa</span>
        <textarea
          className="field min-h-28"
          value={draft.prompt}
          maxLength={8000}
          required
          placeholder="O que o agente deve fazer a cada execução. Ex.: Liste as conversas sem resposta há mais de 1 hora."
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </label>
      <fieldset>
        <legend className="field-label">Agentes inscritos</legend>
        {agents.length === 0 ? (
          <p className="text-sm text-n-slate-11">
            Cadastre um agente de IA em Funcionários para inscrevê-lo.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.agent_ids.includes(a.id)}
                  onChange={(e) => toggleAgent(a.id, e.target.checked)}
                />
                {a.name}
                {!a.active && <span className="text-xs text-n-slate-11">(inativo)</span>}
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-n-slate-11">
          Cada agente trabalha sozinho com o próprio runtime; o resultado chega no seu chat com ele, em
          Agentes.
        </p>
      </fieldset>
      <Toggle checked={draft.active} onChange={(active) => set({ active })} label="Ativo" />
      <ModalFooter busy={busy} submit="Salvar agendamento" onCancel={onCancel} error={error} />
    </form>
  );
}
