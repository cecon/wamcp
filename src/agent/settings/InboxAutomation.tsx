import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { Inbox, WorkingDay } from '../types';
import { Toggle } from '../ui/Settings';
import { useAction } from './useAction';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const defaults = (): WorkingDay[] =>
  DAYS.map((_, day) => ({
    day_of_week: day,
    closed_all_day: day === 0 || day === 6,
    open_minutes: 540,
    close_minutes: 1080,
  }));

interface Props {
  inbox: Inbox;
  onChange: () => Promise<void>;
}

/** Horário e mensagens da caixa no C3Theme (lote 29): saudação, expediente, ausência e CSAT. */
export function InboxAutomation({ inbox, onChange }: Props) {
  const [form, setForm] = useState({
    greeting_enabled: Boolean(inbox.greeting_enabled),
    greeting_message: inbox.greeting_message || '',
    working_hours_enabled: Boolean(inbox.working_hours_enabled),
    out_of_office_message: inbox.out_of_office_message || '',
    csat_survey_enabled: Boolean(inbox.csat_survey_enabled),
    csat_survey_message: inbox.csat_survey_message || '',
    timezone: inbox.timezone,
  });
  const [days, setDays] = useState<WorkingDay[]>(defaults);
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  useEffect(() => {
    void http<WorkingDay[]>(`/inboxes/${inbox.id}/working_hours`)
      .then((rows) => {
        if (rows.length)
          setDays(defaults().map((d) => rows.find((r) => r.day_of_week === d.day_of_week) || d));
      })
      // Without saved hours the editor keeps the Mon–Fri 9h–18h defaults.
      .catch(() => {});
  }, [inbox.id]);
  const setDay = (index: number, patch: Partial<WorkingDay>) =>
    setDays((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(async () => {
          await http(`/inboxes/${inbox.id}`, 'PATCH', {
            ...form,
            greeting_message: form.greeting_message.trim() || null,
            out_of_office_message: form.out_of_office_message.trim() || null,
            csat_survey_message: form.csat_survey_message.trim() || null,
          });
          await http(`/inboxes/${inbox.id}/working_hours`, 'PUT', {
            working_hours: days.map((d) => ({ ...d, closed_all_day: Boolean(d.closed_all_day) })),
          });
          await onChange();
          setSaved(true);
        });
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Toggle
        label="Saudação"
        hint="Enviada quando uma nova conversa começa."
        checked={form.greeting_enabled}
        onChange={(v) => setForm({ ...form, greeting_enabled: v })}
      />
      <TextField
        label="Texto da saudação"
        multiline
        minRows={2}
        value={form.greeting_message}
        onChange={(e) => setForm({ ...form, greeting_message: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      <Toggle
        label="Horário de atendimento"
        hint="Fora do horário, o contato recebe a mensagem de ausência."
        checked={form.working_hours_enabled}
        onChange={(v) => setForm({ ...form, working_hours_enabled: v })}
      />
      <TextField
        label="Fuso horário"
        size="small"
        value={form.timezone}
        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 64 } }}
      />
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', my: 1, fontSize: 14 }}>
        <Box component="tbody">
          {days.map((d, i) => (
            <Box component="tr" key={d.day_of_week} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Box component="td" sx={{ py: 1, pr: 2, fontWeight: 500 }}>
                {DAYS[d.day_of_week]}
              </Box>
              <Box component="td" sx={{ py: 1, pr: 2 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                  <Checkbox
                    size="small"
                    checked={!d.closed_all_day}
                    onChange={(e) => setDay(i, { closed_all_day: !e.target.checked })}
                    slotProps={{ input: { 'aria-label': `Aberto ${DAYS[d.day_of_week]}` } }}
                  />
                  Aberto
                </Stack>
              </Box>
              <Box component="td" sx={{ py: 1, pr: 1 }}>
                <Box
                  component="input"
                  type="time"
                  aria-label={`Abre ${DAYS[d.day_of_week]}`}
                  value={toTime(d.open_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { open_minutes: toMinutes(e.target.value) })}
                  sx={{
                    height: 32,
                    width: 112,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    px: 1,
                    fontSize: 14,
                  }}
                />
              </Box>
              <Box component="td" sx={{ py: 1 }}>
                <Box
                  component="input"
                  type="time"
                  aria-label={`Fecha ${DAYS[d.day_of_week]}`}
                  value={toTime(d.close_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { close_minutes: toMinutes(e.target.value) })}
                  sx={{
                    height: 32,
                    width: 112,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    px: 1,
                    fontSize: 14,
                  }}
                />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      <TextField
        label="Mensagem de ausência"
        multiline
        minRows={2}
        value={form.out_of_office_message}
        onChange={(e) => setForm({ ...form, out_of_office_message: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      <Toggle
        label="Pesquisa de satisfação (CSAT)"
        hint="Ao resolver, pede uma nota de 1 a 5 pelo WhatsApp."
        checked={form.csat_survey_enabled}
        onChange={(v) => setForm({ ...form, csat_survey_enabled: v })}
      />
      <TextField
        label="Mensagem da pesquisa CSAT"
        multiline
        minRows={2}
        placeholder="Texto enviado com o pedido de nota (vazio usa a mensagem padrão)."
        value={form.csat_survey_message}
        onChange={(e) => setForm({ ...form, csat_survey_message: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      {error && (
        <Typography variant="body2" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      )}
      {saved && (
        <Typography variant="body2" sx={{ color: 'success.main' }}>
          Configurações salvas.
        </Typography>
      )}
      <Button type="submit" variant="contained" disabled={busy} sx={{ alignSelf: 'flex-start' }}>
        Salvar mensagens automáticas
      </Button>
    </Box>
  );
}
