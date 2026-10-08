import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { GROUP_TYPE_LABEL, MANAGED_TYPES } from '../format';
import type { ComplementGroup } from '../types';
import { Badge, Section } from '../ui';
import type { EditorLink } from './itemDraft';

interface Props {
  links: EditorLink[];
  library: ComplementGroup[];
  editable: boolean;
  onChange: (links: EditorLink[]) => void;
  onCreateGroup: () => void;
}

const number = 'field !h-8 !w-16 !px-2';

/** Complements attached to the item: library groups with min/max per link and their order. */
export function GroupsSection({ links, library, editable, onChange, onCreateGroup }: Props) {
  const [pick, setPick] = useState('');
  const available = library.filter(
    (g) => !MANAGED_TYPES.includes(g.type) && !links.some((l) => l.group_id === g.id),
  );
  const set = (i: number, patch: Partial<EditorLink>) =>
    onChange(links.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  const move = (i: number, step: -1 | 1) => {
    const next = [...links];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    onChange(next);
  };
  const attach = () => {
    const group = available.find((g) => String(g.id) === pick);
    if (!group) return;
    onChange([...links, { group_id: group.id, min: 0, max: 1, position: links.length, group }]);
    setPick('');
  };

  return (
    <Section
      title="Complementos"
      aside={
        editable && (
          <Button size="xs" variant="link" icon={Plus} label="Criar grupo" onClick={onCreateGroup} />
        )
      }
    >
      {links.length === 0 && <p className="text-sm text-n-slate-11">Nenhum complemento neste item.</p>}
      <ul className="flex flex-col gap-2">
        {links.map((l, i) => (
          <li
            key={l.group_id}
            aria-label={l.group.name}
            className="flex flex-wrap items-center gap-2 rounded-lg p-2 outline outline-1 -outline-offset-1 outline-n-weak"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-n-slate-12">{l.group.name}</span>
              <span className="text-xs text-n-slate-11">
                {GROUP_TYPE_LABEL[l.group.type]} · {l.group.options.length} opções
              </span>
            </span>
            {l.min >= 1 ? <Badge tone="blue">Obrigatório</Badge> : <Badge>Opcional</Badge>}
            <label className="flex items-center gap-1 text-xs text-n-slate-11">
              Mín.
              <input
                type="number"
                min={0}
                className={number}
                aria-label={`Mínimo de ${l.group.name}`}
                value={l.min}
                onChange={(e) => set(i, { min: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-n-slate-11">
              Máx.
              <input
                type="number"
                min={1}
                className={number}
                aria-label={`Máximo de ${l.group.name}`}
                value={l.max}
                onChange={(e) => set(i, { max: Number(e.target.value) })}
              />
            </label>
            {editable && (
              <span className="flex">
                <Button
                  size="xs"
                  color="slate"
                  variant="ghost"
                  icon={ArrowUp}
                  aria-label={`Subir ${l.group.name}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <Button
                  size="xs"
                  color="slate"
                  variant="ghost"
                  icon={ArrowDown}
                  aria-label={`Descer ${l.group.name}`}
                  disabled={i === links.length - 1}
                  onClick={() => move(i, 1)}
                />
                <Button
                  size="xs"
                  color="ruby"
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`Remover ${l.group.name}`}
                  onClick={() => onChange(links.filter((_, j) => j !== i))}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-2">
          <select
            className="field !h-8 !py-0"
            aria-label="Grupo da biblioteca"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Escolha um grupo de complementos…</option>
            {available.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="faded" label="Vincular" disabled={!pick} onClick={attach} />
        </div>
      )}
    </Section>
  );
}
