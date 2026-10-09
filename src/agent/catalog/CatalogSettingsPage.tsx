import { useState } from 'react';
import { Button } from '../ui/Button';
import { SettingsHeader, SettingsPage } from '../ui/Settings';
import { useAction } from '../settings/useAction';
import { useFetch } from '../useFetch';
import { catalogApi } from './catalogApi';
import type { CatalogSettings, PizzaPricing } from './types';

const PRICING: { value: PizzaPricing; label: string; description: string }[] = [
  {
    value: 'greater',
    label: 'Maior valor',
    description:
      'Pizza com mais de um sabor cobra o sabor mais caro no tamanho escolhido (padrão do mercado).',
  },
  {
    value: 'average',
    label: 'Média',
    description: 'Cobra a média dos preços dos sabores escolhidos no tamanho (arredondada para cima).',
  },
];

function SettingsForm({ initial }: { initial: CatalogSettings }) {
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  const invalid = !(draft.notes_max_length >= 1);
  return (
    <form
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(async () => {
          setDraft(await catalogApi.saveSettings(draft));
          setSaved(true);
        });
      }}
    >
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="field-label">Preço da pizza com mais de um sabor</legend>
        {PRICING.map((p) => (
          <label
            key={p.value}
            className={`flex cursor-pointer gap-2 rounded-xl p-3 outline outline-1 -outline-offset-1 ${
              draft.pizza_pricing === p.value ? 'outline-n-brand' : 'outline-n-weak'
            }`}
          >
            <input
              type="radio"
              name="pizza-pricing"
              checked={draft.pizza_pricing === p.value}
              onChange={() => setDraft({ ...draft, pizza_pricing: p.value })}
            />
            <span>
              <span className="block text-sm font-medium text-n-slate-12">{p.label}</span>
              <span className="block text-xs text-n-slate-11">{p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block max-w-xs">
        <span className="field-label">Tamanho máximo das observações do item</span>
        <input
          className="field"
          type="number"
          min={1}
          value={draft.notes_max_length}
          onChange={(e) => setDraft({ ...draft, notes_max_length: Number(e.target.value) })}
        />
      </label>
      {invalid && <p className="text-sm text-n-ruby-11">Informe um número de caracteres maior que zero.</p>}
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-n-teal-11">
          Configurações salvas.
        </p>
      )}
      <Button type="submit" label="Salvar" className="self-start" disabled={busy || invalid} />
    </form>
  );
}

/** Catálogo → Configurações: pizza pricing rule and the notes length limit. */
export function CatalogSettingsPage() {
  const { data, error } = useFetch<CatalogSettings>('/catalog/settings');
  return (
    <SettingsPage>
      <SettingsHeader
        title="Configurações do cardápio"
        description="Regras usadas no cálculo dos pedidos pela IA, pelos agentes e pelo simulador."
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      {data && <SettingsForm initial={data} />}
    </SettingsPage>
  );
}
