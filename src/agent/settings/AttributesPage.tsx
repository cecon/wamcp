import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { AttributeDefinition, FilterType } from '../types';
import { ATTRIBUTE_MODEL_LABEL, ATTRIBUTE_TYPE_LABEL } from '../labels';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { ConfirmModal } from '../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../ui/Settings';
import { AttributeModal } from './AttributeModal';

/** Chatwoot Custom Attributes settings: Conversation/Contact tabs, table and add/edit modal. */
export function AttributesPage() {
  const { definitions, reload } = useAttributeDefinitions();
  const [model, setModel] = useState<FilterType>('conversation'),
    [editing, setEditing] = useState<AttributeDefinition | 'new' | null>(null),
    [deleting, setDeleting] = useState<AttributeDefinition | null>(null);
  const visible = definitions.filter((d) => d.attribute_model === model);
  return (
    <SettingsPage>
      <SettingsHeader
        title="Atributos personalizados"
        description="Guarde informações extras de conversas e contatos, como plano contratado ou data da compra."
        count={`${visible.length} atributo${visible.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar atributo" onClick={() => setEditing('new')} />}
      />
      <nav role="tablist" className="flex gap-4 border-b border-n-weak">
        {(['conversation', 'contact'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={model === m}
            onClick={() => setModel(m)}
            className={cn(
              'border-b-2 py-2 text-sm font-medium',
              model === m ? 'border-n-brand text-n-blue-11' : 'border-transparent text-n-slate-11',
            )}
          >
            {ATTRIBUTE_MODEL_LABEL[m]}
          </button>
        ))}
      </nav>
      <Table
        headers={['Nome', 'Chave', 'Tipo', 'Descrição', 'Ações']}
        rows={visible.length}
        empty="Nenhum atributo personalizado ainda."
      >
        {visible.map((d) => (
          <tr key={d.id}>
            <Cell className="font-medium text-n-slate-12">{d.attribute_display_name}</Cell>
            <Cell>
              <code className="text-xs">{d.attribute_key}</code>
            </Cell>
            <Cell>{ATTRIBUTE_TYPE_LABEL[d.attribute_display_type]}</Cell>
            <Cell>{d.attribute_description || '—'}</Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={d.attribute_display_name}
                onEdit={() => setEditing(d)}
                onDelete={() => setDeleting(d)}
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <AttributeModal
          definition={editing === 'new' ? null : editing}
          model={model}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir atributo"
          description={`O atributo “${deleting.attribute_display_name}” será removido das definições.`}
          confirm="Excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await http(`/custom_attribute_definitions/${deleting.id}`, 'DELETE');
            await reload();
          }}
        />
      )}
    </SettingsPage>
  );
}
