import { money, TEMPLATE_LABEL } from '../format';
import type { ImportJob, PreviewGroup } from '../types';

const COUNTS: [keyof NonNullable<ImportJob['counts']>, string][] = [
  ['categories', 'Categorias'],
  ['items', 'Itens'],
  ['groups', 'Grupos de complementos'],
  ['options', 'Opções'],
  ['images', 'Fotos'],
];

export function ImportCounts({ counts }: { counts: ImportJob['counts'] }) {
  if (!counts) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {COUNTS.map(([key, label]) => (
        <div
          key={key}
          className="rounded-xl bg-n-slate-2 p-3 outline outline-1 -outline-offset-1 outline-n-weak"
        >
          <dt className="text-xs text-n-slate-11">{label}</dt>
          <dd className="text-lg font-semibold text-n-slate-12">{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ group }: { group: PreviewGroup }) {
  return (
    <details className="ml-4">
      <summary className="cursor-pointer text-sm text-n-slate-12">
        {group.name}{' '}
        <span className="text-xs text-n-slate-11">
          ({group.min >= 1 ? 'obrigatório' : 'opcional'}, mín. {group.min} · máx. {group.max})
        </span>
      </summary>
      <ul className="ml-6 list-disc text-sm text-n-slate-11">
        {group.options.map((o, i) => (
          <li key={i}>
            {o.name} — {money(o.price_cents)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Collapsible preview: categories → items → groups (min/max) → options with prices. */
export function PreviewTree({ preview }: { preview: NonNullable<ImportJob['preview']> }) {
  return (
    <div
      aria-label="Prévia do cardápio"
      className="flex flex-col gap-1 rounded-xl p-3 outline outline-1 -outline-offset-1 outline-n-weak"
    >
      {preview.categories.map((c, ci) => (
        <details key={ci}>
          <summary className="cursor-pointer text-sm font-medium text-n-slate-12">
            {c.name}{' '}
            <span className="text-xs font-normal text-n-slate-11">
              ({c.items.length} itens · {TEMPLATE_LABEL[c.template]})
            </span>
          </summary>
          {c.items.map((item, ii) => (
            <details key={ii} className="ml-4">
              <summary className="cursor-pointer text-sm text-n-slate-12">
                {item.name}{' '}
                <span className="text-xs text-n-slate-11">
                  {item.original_price_cents != null && <s>{money(item.original_price_cents)}</s>}{' '}
                  {money(item.price_cents)}
                  {item.external_code && ` · PDV ${item.external_code}`}
                </span>
              </summary>
              {item.groups.map((g, gi) => (
                <Group key={gi} group={g} />
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}
