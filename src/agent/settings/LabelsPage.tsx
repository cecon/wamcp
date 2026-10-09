import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Label } from '../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { Cell, ModalFooter, RowActions, SettingsHeader, SettingsPage, Table } from '../ui/Settings';
import { useAction } from './useAction';

interface Props {
  catalog: Catalog;
  onChange: () => Promise<void>;
}

/** Chatwoot Labels: Name | Description | Color | Actions, with the add/edit modal. */
export function LabelsPage({ catalog, onChange }: Props) {
  const [q, setQ] = useState(''),
    [editing, setEditing] = useState<Label | 'new' | null>(null);
  const { error, run } = useAction();
  const visible = catalog.labels.filter((l) => l.title.includes(q.toLowerCase()));
  return (
    <SettingsPage>
      <SettingsHeader
        title="Etiquetas"
        description="Etiquetas ajudam a categorizar e priorizar conversas. Você pode adicioná-las pelo painel da conversa."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar etiquetas…' }}
        count={`${catalog.labels.length} etiqueta${catalog.labels.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar etiqueta" onClick={() => setEditing('new')} />}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={['Nome', 'Descrição', 'Cor', 'Ações']}
        rows={visible.length}
        empty="Nenhuma etiqueta ainda."
      >
        {visible.map((l) => (
          <tr key={l.id}>
            <Cell className="font-medium text-n-slate-12">{l.title}</Cell>
            <Cell>{l.description || '—'}</Cell>
            <Cell>
              <span className="flex items-center gap-2">
                <span className="size-4 rounded border border-n-weak" style={{ background: l.color }} />
                {l.color}
              </span>
            </Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={l.title}
                onEdit={() => setEditing(l)}
                onDelete={() =>
                  void run(async () => {
                    await http(`/labels/${l.id}`, 'DELETE');
                    await onChange();
                  })
                }
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <LabelModal
          label={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </SettingsPage>
  );
}

function LabelModal({
  label,
  onClose,
  onSaved,
}: {
  label: Label | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: label?.title || '',
    description: label?.description || '',
    color: label?.color || '#2781F6',
  });
  const { error, busy, run } = useAction();
  return (
    <Modal
      title={label ? 'Editar etiqueta' : 'Adicionar etiqueta'}
      description="O nome vira minúsculas e sem espaços."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = { ...form, description: form.description.trim() || null };
            await http(label ? `/labels/${label.id}` : '/labels', label ? 'PATCH' : 'POST', body);
            await onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome da etiqueta</span>
          <input
            className="field"
            value={form.title}
            maxLength={40}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <textarea
            className="field"
            value={form.description}
            maxLength={200}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Cor</span>
          <span className="flex h-8 w-fit items-center gap-2 rounded-lg bg-n-button-color px-2 text-sm outline outline-1 -outline-offset-1 outline-n-container">
            <input
              type="color"
              aria-label="Cor"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="size-5 cursor-pointer rounded-md border-0 bg-transparent p-0"
            />
            {form.color.toUpperCase()}
          </span>
        </label>
        <ModalFooter busy={busy} submit={label ? 'Salvar' : 'Criar'} onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
