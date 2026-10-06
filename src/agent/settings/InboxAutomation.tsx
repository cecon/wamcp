import { useEffect, useState } from 'react';
import { http } from '../api';
import type { Inbox, WorkingDay } from '../types';
import { useAction } from './useAction';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

/** Greeting, out-of-office with weekly business hours, and CSAT survey for one inbox. */
export function InboxAutomation({ inbox, onChange }: Props) {
  const [form, setForm] = useState({
    greeting_enabled: Boolean(inbox.greeting_enabled),
    greeting_message: inbox.greeting_message || '',
    working_hours_enabled: Boolean(inbox.working_hours_enabled),
    out_of_office_message: inbox.out_of_office_message || '',
    csat_survey_enabled: Boolean(inbox.csat_survey_enabled),
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
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(async () => {
          await http(`/inboxes/${inbox.id}`, 'PATCH', {
            ...form,
            greeting_message: form.greeting_message.trim() || null,
            out_of_office_message: form.out_of_office_message.trim() || null,
          });
          await http(`/inboxes/${inbox.id}/working_hours`, 'PUT', {
            working_hours: days.map((d) => ({ ...d, closed_all_day: Boolean(d.closed_all_day) })),
          });
          await onChange();
          setSaved(true);
        });
      }}
    >
      <h2>Mensagens automáticas</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.greeting_enabled}
          onChange={(e) => setForm({ ...form, greeting_enabled: e.target.checked })}
        />
        <span>
          <strong>Saudação</strong>
          <small>Enviada quando uma nova conversa começa.</small>
        </span>
      </label>
      <label>
        Texto da saudação
        <textarea
          value={form.greeting_message}
          onChange={(e) => setForm({ ...form, greeting_message: e.target.value })}
          rows={2}
          maxLength={1000}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.working_hours_enabled}
          onChange={(e) => setForm({ ...form, working_hours_enabled: e.target.checked })}
        />
        <span>
          <strong>Horário de atendimento</strong>
          <small>Fora do horário, o contato recebe a mensagem de ausência.</small>
        </span>
      </label>
      <label>
        Fuso horário
        <input
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          maxLength={64}
        />
      </label>
      <table className="schedule">
        <tbody>
          {days.map((d, i) => (
            <tr key={d.day_of_week}>
              <td>{DAYS[d.day_of_week]}</td>
              <td>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!d.closed_all_day}
                    onChange={(e) => setDay(i, { closed_all_day: !e.target.checked })}
                    aria-label={`Aberto ${DAYS[d.day_of_week]}`}
                  />
                  Aberto
                </label>
              </td>
              <td>
                <input
                  type="time"
                  value={toTime(d.open_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { open_minutes: toMinutes(e.target.value) })}
                  aria-label={`Abre ${DAYS[d.day_of_week]}`}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={toTime(d.close_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { close_minutes: toMinutes(e.target.value) })}
                  aria-label={`Fecha ${DAYS[d.day_of_week]}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>
        Mensagem de ausência
        <textarea
          value={form.out_of_office_message}
          onChange={(e) => setForm({ ...form, out_of_office_message: e.target.value })}
          rows={2}
          maxLength={1000}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.csat_survey_enabled}
          onChange={(e) => setForm({ ...form, csat_survey_enabled: e.target.checked })}
        />
        <span>
          <strong>Pesquisa de satisfação (CSAT)</strong>
          <small>Ao resolver, pede uma nota de 1 a 5 pelo WhatsApp.</small>
        </span>
      </label>
      {error && <p className="form-error">{error}</p>}
      {saved && <p className="muted">Configurações salvas.</p>}
      <button className="btn primary" disabled={busy}>
        Salvar mensagens automáticas
      </button>
    </form>
  );
}
