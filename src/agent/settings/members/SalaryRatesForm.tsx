import { useState } from 'react';
import { http } from '../../api';
import type { Account } from '../../parityTypes';
import { Button } from '../../ui/Button';
import { useAction } from '../useAction';

/** Defaults of the vision doc (keep in sync with `domain::salary`). */
const DEFAULTS = { seat: 50, margin: 50, rate: 5.5 };

/** "Salário digital": a person's monthly seat, the margin on AI token costs and the dollar rate. */
export function SalaryRatesForm({ account }: { account: Account }) {
  const s = account.settings || {};
  const [form, setForm] = useState({
    seat: String(s.seat_price_brl ?? DEFAULTS.seat),
    margin: String(s.ai_margin_percent ?? DEFAULTS.margin),
    rate: String(s.usd_brl_rate ?? DEFAULTS.rate),
  });
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form, label: string, hint: string, step: string) => (
    <div>
      <label>
        <span className="field-label">{label}</span>
        <input
          className="field"
          type="number"
          min={0}
          step={step}
          required
          value={form[key]}
          onChange={(e) => {
            setSaved(false);
            setForm({ ...form, [key]: e.target.value });
          }}
        />
      </label>
      <span className="mt-1 block text-xs text-n-slate-11">{hint}</span>
    </div>
  );
  return (
    <form
      aria-label="Salário digital"
      className="flex max-w-2xl flex-col gap-4 border-t border-n-weak pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await http('/account', 'PATCH', {
            seat_price_brl: Number(form.seat),
            ai_margin_percent: Number(form.margin),
            usd_brl_rate: Number(form.rate),
          });
          setSaved(true);
        });
      }}
    >
      <div>
        <h2 className="text-heading-3 text-n-slate-12">Salário digital</h2>
        <p className="text-sm text-n-slate-11">
          Quanto cada membro custa no painel de Funcionários. O salário de um agente de IA começa o mês em
          zero e acumula o custo dos tokens das suas tarefas com a margem.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {field('seat', 'Assento por pessoa (R$/mês)', 'Cobrado de cada pessoa ativa.', '0.01')}
        {field('margin', 'Margem sobre a IA (%)', 'Somada ao custo dos tokens.', '1')}
        {field('rate', 'Cotação do dólar (R$)', 'Os runtimes informam o custo em dólar.', '0.01')}
      </div>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      {saved && <p className="text-sm text-n-teal-11">Valores do salário digital salvos.</p>}
      <Button type="submit" size="md" className="self-start" disabled={busy} label="Salvar valores" />
    </form>
  );
}
