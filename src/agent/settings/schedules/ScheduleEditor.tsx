import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
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
    <Stack
      component="form"
      spacing={3}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <TextField
        label="Nome"
        size="small"
        value={draft.name}
        placeholder="Ex.: Resumo das pendências"
        onChange={(e) => set({ name: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 80, required: true } }}
      />
      <TextField
        select
        label="Quando"
        size="small"
        value={custom ? 'custom' : presetOf(draft)}
        onChange={(e) => pick(e.target.value)}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Personalizado…</option>
      </TextField>
      {custom && (
        <Stack spacing={2} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={
                <Radio
                  size="small"
                  name="schedule-kind"
                  checked={!byInterval}
                  onChange={() => set({ cron: draft.cron || '0 9 * * *', interval_minutes: null })}
                />
              }
              label="Por expressão cron"
            />
            <FormControlLabel
              control={
                <Radio
                  size="small"
                  name="schedule-kind"
                  checked={byInterval}
                  onChange={() => set({ cron: null, interval_minutes: draft.interval_minutes || 30 })}
                />
              }
              label="Por intervalo"
            />
          </Stack>
          {byInterval ? (
            <TextField
              label="A cada quantos minutos"
              size="small"
              type="number"
              value={draft.interval_minutes ?? ''}
              onChange={(e) => set({ interval_minutes: Number(e.target.value) || null })}
              slotProps={{ htmlInput: { min: 1, max: 10080 } }}
            />
          ) : (
            <Box>
              <TextField
                label="Expressão cron"
                size="small"
                fullWidth
                value={draft.cron ?? ''}
                placeholder="minuto hora dia mês dia-da-semana"
                onChange={(e) => set({ cron: e.target.value })}
                sx={{ '& input': { fontFamily: 'monospace' } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Ex.: <code>*/30 8-18 * * 1-5</code> = a cada 30 minutos, das 8h às 18h, de segunda a sexta.
              </Typography>
            </Box>
          )}
          <TextField
            label="Fuso horário"
            size="small"
            value={draft.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          />
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" aria-live="polite">
        {upcoming.error ? (
          <Typography component="span" variant="caption" sx={{ color: 'error.main' }}>
            {upcoming.error}
          </Typography>
        ) : (
          upcoming.times.length > 0 && (
            <span>
              Próximas execuções: {upcoming.times.map((t) => formatTime(t, draft.timezone)).join(' · ')}
            </span>
          )
        )}
      </Typography>
      <TextField
        label="Tarefa"
        size="small"
        multiline
        minRows={4}
        value={draft.prompt}
        placeholder="O que o agente deve fazer a cada execução. Ex.: Liste as conversas sem resposta há mais de 1 hora."
        onChange={(e) => set({ prompt: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 8000, required: true } }}
      />
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Typography component="legend" variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
          Agentes inscritos
        </Typography>
        {agents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Cadastre um agente de IA em Funcionários para inscrevê-lo.
          </Typography>
        ) : (
          <Stack sx={{ gap: 1 }}>
            {agents.map((a) => (
              <FormControlLabel
                key={a.id}
                control={
                  <Checkbox
                    size="small"
                    checked={draft.agent_ids.includes(a.id)}
                    onChange={(e) => toggleAgent(a.id, e.target.checked)}
                  />
                }
                label={
                  <span>
                    {a.name}
                    {!a.active && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}
                        (inativo)
                      </Typography>
                    )}
                  </span>
                }
              />
            ))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Cada agente trabalha sozinho com o próprio runtime; o resultado chega no seu chat com ele, em
          Agentes.
        </Typography>
      </Box>
      <FormControlLabel
        control={<Checkbox checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />}
        label="Ativo"
      />
      {error && (
        <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button type="button" variant="outlined" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={busy}>
          Salvar agendamento
        </Button>
      </Stack>
    </Stack>
  );
}
