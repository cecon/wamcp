import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { Canned } from '../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { Cell, ModalFooter, RowActions, SettingsHeader, SettingsPage, Table } from '../ui/Settings';
import { useAction } from './useAction';

/** Chatwoot Canned responses: Short code | Content | Actions, with the add/edit modal. */
export function CannedPage() {
  const [items, setItems] = useState<Canned[]>([]),
    [q, setQ] = useState(''),
    [editing, setEditing] = useState<Canned | 'new' | null>(null);
  const { error, run } = useAction();
  const load = useCallback(() => http<Canned[]>('/canned_responses').then(setItems), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const visible = items.filter((c) => `${c.short_code} ${c.content}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <SettingsPage>
      <SettingsHeader
        title="Respostas prontas"
        description="Modelos de resposta para agilizar o atendimento. No editor, digite “/” seguido do atalho."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar respostas…' }}
        count={`${items.length} resposta${items.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar resposta pronta" onClick={() => setEditing('new')} />}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={['Atalho', 'Conteúdo', 'Ações']}
        rows={visible.length}
        empty="Nenhuma resposta pronta ainda."
      >
        {visible.map((c) => (
          <tr key={c.id}>
            <Cell className="w-48 font-medium text-n-slate-12">/{c.short_code}</Cell>
            <Cell>
              <span className="line-clamp-2 whitespace-pre-wrap">{c.content}</span>
            </Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={`/${c.short_code}`}
                onEdit={() => setEditing(c)}
                onDelete={() =>
                  void run(async () => {
                    await http(`/canned_responses/${c.id}`, 'DELETE');
                    await load();
                  })
                }
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <CannedModal
          canned={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </SettingsPage>
  );
}

function CannedModal({
  canned,
  onClose,
  onSaved,
}: {
  canned: Canned | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({ short_code: canned?.short_code || '', content: canned?.content || '' });
  const { error, busy, run } = useAction();
  return (
    <Modal title={canned ? 'Editar resposta pronta' : 'Adicionar resposta pronta'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http(
              canned ? `/canned_responses/${canned.id}` : '/canned_responses',
              canned ? 'PATCH' : 'POST',
              form,
            );
            await onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Atalho</span>
          <input
            className="field"
            value={form.short_code}
            placeholder="saudacao"
            maxLength={40}
            required
            onChange={(e) => setForm({ ...form, short_code: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Mensagem</span>
          <textarea
            className="field"
            rows={5}
            value={form.content}
            maxLength={4096}
            required
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <ModalFooter busy={busy} submit="Salvar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
