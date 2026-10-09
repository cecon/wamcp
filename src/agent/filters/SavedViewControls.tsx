import { useState } from 'react';
import { EllipsisVertical, Pencil, Save, Trash2 } from 'lucide-react';
import { http } from '../api';
import type { CustomFilter, FilterCondition, FilterType } from '../types';
import { useAction } from '../settings/useAction';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Confirm';
import { Dropdown, MenuItem, Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';

function NameModal({
  title,
  initial = '',
  submit,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submit: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const { error, busy, run } = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await onSubmit(name.trim());
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome da visualização</span>
          <input
            className="field"
            value={name}
            maxLength={80}
            required
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ModalFooter busy={busy} submit={submit} onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}

/** "Salvar visualização": stores the current filter as a Chatwoot custom filter (folder/segment). */
export function SaveViewButton({
  filterType,
  payload,
  onSaved,
}: {
  filterType: FilterType;
  payload: FilterCondition[];
  onSaved: (view: CustomFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        color="slate"
        variant="faded"
        size="xs"
        icon={Save}
        label="Salvar visualização"
        onClick={() => setOpen(true)}
      />
      {open && (
        <NameModal
          title="Salvar visualização"
          submit="Salvar"
          onClose={() => setOpen(false)}
          onSubmit={async (name) =>
            onSaved(
              await http<CustomFilter>('/custom_filters', 'POST', {
                name,
                filter_type: filterType,
                query: { payload },
              }),
            )
          }
        />
      )}
    </>
  );
}

/** Rename / delete menu of the active saved view (owner only on the server). */
export function ViewMenu({
  view,
  onRenamed,
  onDeleted,
}: {
  view: CustomFilter;
  onRenamed: (view: CustomFilter) => void;
  onDeleted: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const path = `/custom_filters/${view.id}`;
  return (
    <>
      <Dropdown
        trigger={({ toggle }) => (
          <Button
            color="slate"
            variant="faded"
            size="xs"
            icon={EllipsisVertical}
            aria-label="Opções da visualização"
            onClick={toggle}
          />
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={Pencil}
              label="Renomear visualização"
              onClick={() => {
                close();
                setDialog('rename');
              }}
            />
            <MenuItem
              icon={Trash2}
              danger
              label="Excluir visualização"
              onClick={() => {
                close();
                setDialog('delete');
              }}
            />
          </>
        )}
      </Dropdown>
      {dialog === 'rename' && (
        <NameModal
          title="Renomear visualização"
          initial={view.name}
          submit="Salvar"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => onRenamed(await http<CustomFilter>(path, 'PATCH', { name }))}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmModal
          title="Excluir visualização"
          description={`A visualização “${view.name}” será removida. As conversas e contatos não são afetados.`}
          confirm="Excluir"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await http(path, 'DELETE');
            onDeleted();
          }}
        />
      )}
    </>
  );
}
