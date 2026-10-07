import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { Macro } from '../accountTypes';
import type { Catalog, User } from '../types';
import { ACTIONS } from '../labels';
import { useMacros, VISIBILITY_LABEL } from '../macros/useMacros';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Confirm';
import { SidePanel } from '../ui/Overlay';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../ui/Settings';
import { MacroEditor, type MacroDraft } from './MacroEditor';
import { useAction } from './useAction';

/** Chatwoot Macros settings: personal and public macros, edited in a side panel. */
export function MacrosPage({ user, catalog }: { user: User; catalog: Catalog }) {
  const { macros, error: loadError, reload } = useMacros();
  const [q, setQ] = useState(''),
    [editing, setEditing] = useState<Macro | 'new' | null>(null),
    [deleting, setDeleting] = useState<Macro | null>(null);
  const { error, busy, run } = useAction();
  const isAdmin = user.role === 'administrator';
  const visible = macros.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  const save = (draft: MacroDraft) =>
    void run(async () => {
      if (editing === 'new') await http('/macros', 'POST', draft);
      else if (editing) await http(`/macros/${editing.id}`, 'PATCH', draft);
      setEditing(null);
      await reload();
    });

  return (
    <SettingsPage>
      <SettingsHeader
        title="Macros"
        description="Uma macro é um conjunto de ações salvas (atribuir, etiquetar, responder, resolver…) que o agente executa em uma conversa com um único clique."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar macros…' }}
        count={`${macros.length} macro${macros.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar macro" onClick={() => setEditing('new')} />}
      />
      {loadError && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {loadError}
        </p>
      )}
      <Table
        headers={['Nome', 'Criada por', 'Visibilidade', '']}
        rows={visible.length}
        empty="Nenhuma macro encontrada."
      >
        {visible.map((m) => {
          const editable = isAdmin || m.visibility === 'personal';
          return (
            <tr key={m.id}>
              <Cell>
                <span className="block font-medium text-n-slate-12">{m.name}</span>
                <span className="text-sm">
                  {m.actions.map((a) => ACTIONS[a.action_name] || a.action_name).join(' → ')}
                </span>
              </Cell>
              <Cell>{m.created_by_name || '—'}</Cell>
              <Cell>{VISIBILITY_LABEL[m.visibility]}</Cell>
              <Cell className="w-24">
                {editable && (
                  <RowActions
                    labelFor={m.name}
                    onEdit={() => setEditing(m)}
                    onDelete={() => setDeleting(m)}
                  />
                )}
              </Cell>
            </tr>
          );
        })}
      </Table>
      {editing && (
        <SidePanel
          title={editing === 'new' ? 'Adicionar macro' : 'Editar macro'}
          onClose={() => setEditing(null)}
        >
          <MacroEditor
            macro={editing === 'new' ? undefined : editing}
            catalog={catalog}
            isAdmin={isAdmin}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </SidePanel>
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir macro"
          description={`Você tem certeza que deseja excluir “${deleting.name}”?`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await http(`/macros/${deleting.id}`, 'DELETE');
            await reload();
          }}
        />
      )}
    </SettingsPage>
  );
}
