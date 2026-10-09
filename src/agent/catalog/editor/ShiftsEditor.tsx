import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { DAYS } from '../format';
import type { Shift } from '../types';

interface Props {
  shifts: Shift[];
  onChange: (shifts: Shift[]) => void;
}

/** Availability windows: days Dom–Sáb plus start/end; no rows means always available. */
export function ShiftsEditor({ shifts, onChange }: Props) {
  const set = (i: number, patch: Partial<Shift>) =>
    onChange(shifts.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  const toggleDay = (i: number, day: number) => {
    const days = shifts[i].days;
    set(i, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label">Horários de disponibilidade</legend>
      {shifts.length === 0 && (
        <p className="text-sm text-n-slate-11">Sempre disponível (sem restrição de dia ou horário).</p>
      )}
      {shifts.map((s, i) => (
        <div
          key={i}
          role="group"
          aria-label={`Horário ${i + 1}`}
          className="flex flex-wrap items-center gap-2 rounded-lg p-2 outline outline-1 -outline-offset-1 outline-n-weak"
        >
          <div className="flex gap-1">
            {DAYS.map((label, day) => (
              <label key={label} className="flex items-center gap-1 text-xs text-n-slate-12">
                <input type="checkbox" checked={s.days.includes(day)} onChange={() => toggleDay(i, day)} />
                {label}
              </label>
            ))}
          </div>
          <input
            type="time"
            aria-label={`Início do horário ${i + 1}`}
            className="field !h-8 !w-28"
            value={s.start}
            onChange={(e) => set(i, { start: e.target.value })}
          />
          <span className="text-xs text-n-slate-11">até</span>
          <input
            type="time"
            aria-label={`Fim do horário ${i + 1}`}
            className="field !h-8 !w-28"
            value={s.end}
            onChange={(e) => set(i, { end: e.target.value })}
          />
          {s.end < s.start && <span className="text-xs text-n-slate-11">(termina no dia seguinte)</span>}
          <Button
            size="xs"
            color="slate"
            variant="ghost"
            icon={Trash2}
            aria-label={`Remover horário ${i + 1}`}
            onClick={() => onChange(shifts.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="faded"
        icon={Plus}
        label="Adicionar horário"
        className="self-start"
        onClick={() => onChange([...shifts, { days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '15:00' }])}
      />
    </fieldset>
  );
}
