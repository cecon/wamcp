import { useRef, useState } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { useAction } from '../useAction';
import { SkillModal } from './SkillModal';

/** Skill library: what operators know how to do, written here or imported from a SKILL.md. */
export function SkillsPage() {
  const { data, error, reload } = useFetch<Skill[]>('/skills');
  const [editing, setEditing] = useState<Skill | 'new' | null>(null),
    [removing, setRemoving] = useState<Skill | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const importing = useAction();
  const skills = data || [];

  return (
    <SettingsPage>
      <SettingsHeader
        title="Skills"
        description="Instruções e ferramentas que os agentes de IA executores usam. Importe um SKILL.md no formato do Claude Code (cabeçalho com name, description e allowed-tools) ou escreva aqui."
        count={`${skills.length} skill${skills.length === 1 ? '' : 's'}`}
        action={
          <div className="flex gap-2">
            <Button
              icon={FileUp}
              color="slate"
              variant="faded"
              label="Importar SKILL.md"
              disabled={importing.busy}
              onClick={() => file.current?.click()}
            />
            <Button icon={Plus} label="Adicionar skill" onClick={() => setEditing('new')} />
          </div>
        }
      />
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        aria-label="Arquivo SKILL.md"
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (!chosen) return;
          void importing.run(async () => {
            await http('/skills/import', 'POST', { content: await chosen.text() });
            reload();
          });
        }}
      />
      {(error || importing.error) && <p className="text-sm text-n-ruby-11">{error || importing.error}</p>}
      <Table headers={['Skill', 'Ferramentas', '']} rows={skills.length} empty="Nenhuma skill ainda.">
        {skills.map((skill) => (
          <tr key={skill.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{skill.name}</span>
              {skill.description && <span className="text-sm">{skill.description}</span>}
            </Cell>
            <Cell className="break-all">{skill.tools.join(', ') || '—'}</Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={skill.name}
                onEdit={() => setEditing(skill)}
                onDelete={() => setRemoving(skill)}
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <SkillModal
          skill={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir a skill “${removing.name}”?`}
          description="Os agentes que a usam deixam de tê-la."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/skills/${removing.id}`, 'DELETE');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}
