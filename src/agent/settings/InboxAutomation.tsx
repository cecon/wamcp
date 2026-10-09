import { useEffect, useState } from 'react';
import { http } from '../api';
import type { Inbox, WorkingDay } from '../types';
import { Button } from '../ui/Button';
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

/** Inbox business hours (Chatwoot "Business Hours" tab) plus greeting, out-of-office and CSAT. */
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
      className="flex flex-col gap-2"
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
      <Toggle
        label="Saudação"
        hint="Enviada quando uma nova conversa começa."
        checked={form.greeting_enabled}
        onChange={(v) => setForm({ ...form, greeting_enabled: v })}
      />
      <label>
        <span className="field-label">Texto da saudação</span>
        <textarea
          className="field"
          rows={2}
          maxLength={1000}
          value={form.greeting_message}
          onChange={(e) => setForm({ ...form, greeting_message: e.target.value })}
        />
      </label>
      <Toggle
        label="Horário de atendimento"
        hint="Fora do horário, o contato recebe a mensagem de ausência."
        checked={form.working_hours_enabled}
        onChange={(v) => setForm({ ...form, working_hours_enabled: v })}
      />
      <label>
        <span className="field-label">Fuso horário</span>
        <input
          className="field"
          maxLength={64}
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
      </label>
      <table className="my-2 w-full divide-y divide-n-weak text-sm">
        <tbody className="divide-y divide-n-weak">
          {days.map((d, i) => (
            <tr key={d.day_of_week}>
              <td className="py-2 pr-4 font-medium text-n-slate-12">{DAYS[d.day_of_week]}</td>
              <td className="py-2 pr-4">
                <label className="flex items-center gap-2 text-n-slate-11">
                  <input
                    type="checkbox"
                    className="size-4 accent-n-brand"
                    aria-label={`Aberto ${DAYS[d.day_of_week]}`}
                    checked={!d.closed_all_day}
                    onChange={(e) => setDay(i, { closed_all_day: !e.target.checked })}
                  />
                  Aberto
                </label>
              </td>
              <td className="py-2 pr-2">
                <input
                  type="time"
                  className="field !h-8 !w-28 !py-1"
                  aria-label={`Abre ${DAYS[d.day_of_week]}`}
                  value={toTime(d.open_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { open_minutes: toMinutes(e.target.value) })}
                />
              </td>
              <td className="py-2">
                <input
                  type="time"
                  className="field !h-8 !w-28 !py-1"
                  aria-label={`Fecha ${DAYS[d.day_of_week]}`}
                  value={toTime(d.close_minutes)}
                  disabled={Boolean(d.closed_all_day)}
                  onChange={(e) => setDay(i, { close_minutes: toMinutes(e.target.value) })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>
        <span className="field-label">Mensagem de ausência</span>
        <textarea
          className="field"
          rows={2}
          maxLength={1000}
          value={form.out_of_office_message}
          onChange={(e) => setForm({ ...form, out_of_office_message: e.target.value })}
        />
      </label>
      <Toggle
        label="Pesquisa de satisfação (CSAT)"
        hint="Ao resolver, pede uma nota de 1 a 5 pelo WhatsApp."
        checked={form.csat_survey_enabled}
        onChange={(v) => setForm({ ...form, csat_survey_enabled: v })}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      {saved && <p className="text-sm text-n-teal-11">Configurações salvas.</p>}
      <Button type="submit" disabled={busy} className="self-start" label="Salvar mensagens automáticas" />
    </form>
  );
}
