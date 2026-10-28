import { useRef, useState } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import { Button } from '../../ui/Button';
import { useAction } from '../useAction';

interface Props {
  library: Skill[];
  selected: number[];
  onToggle: (id: number) => void;
  /** A skill created or imported here: added to the library and linked to the agent. */
  onCreated: (skill: Skill) => void;
}

/** Links skills to an agent, creating a new one or importing a SKILL.md without leaving the form. */
export function SkillPicker({ library, selected, onToggle, onCreated }: Props) {
  const [draft, setDraft] = useState<{ name: string; instructions: string; tools: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { error, busy, run } = useAction();
  const create = (body: object, path = '/skills') =>
    run(async () => {
      onCreated(await http<Skill>(path, 'POST', body));
      setDraft(null);
    });

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label">Skills</legend>
      {library.length === 0 && !draft && (
        <p className="text-sm">Nenhuma skill ainda: crie uma aqui ou importe um SKILL.md.</p>
      )}
      {library.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm text-n-slate-12">
          <input
            type="checkbox"
            className="size-4 accent-n-brand"
            checked={selected.includes(s.id)}
            onChange={() => onToggle(s.id)}
          />
          {s.name}
          {s.description && <span className="text-xs text-n-slate-11">— {s.description}</span>}
        </label>
      ))}
      {draft ? (
        <div className="flex flex-col gap-2 rounded-lg border border-n-weak p-3" aria-label="Nova skill">
          <input
            className="field"
            maxLength={80}
            placeholder="Nome da skill"
            aria-label="Nome da nova skill"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className="field"
            rows={3}
            placeholder="Instruções: como o agente deve executar"
            aria-label="Instruções da nova skill"
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          />
          <input
            className="field"
            placeholder="Ferramentas (ex.: reply_conversation, conversation_*)"
            aria-label="Ferramentas da nova skill"
            value={draft.tools}
            onChange={(e) => setDraft({ ...draft, tools: e.target.value })}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              label="Criar e vincular"
              disabled={busy || !draft.name.trim()}
              onClick={() =>
                void create({
                  name: draft.name.trim(),
                  instructions: draft.instructions,
                  tools: draft.tools
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
            <Button size="sm" color="slate" variant="faded" label="Cancelar" onClick={() => setDraft(null)} />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            color="slate"
            variant="faded"
            icon={Plus}
            label="Nova skill"
            onClick={() => setDraft({ name: '', instructions: '', tools: '' })}
          />
          <Button
            size="sm"
            color="slate"
            variant="faded"
            icon={FileUp}
            label="Importar SKILL.md"
            disabled={busy}
            onClick={() => file.current?.click()}
          />
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        aria-label="Importar SKILL.md para este agente"
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (chosen) void chosen.text().then((content) => create({ content }, '/skills/import'));
        }}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
    </fieldset>
  );
}
