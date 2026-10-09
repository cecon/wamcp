import { useState } from 'react';
import { Eye, Plus } from 'lucide-react';
import { ApiError, type Realtime } from '../../api';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SidePanel } from '../../ui/Overlay';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { catalogApi } from '../catalogApi';
import { GROUP_TYPE_LABEL, money } from '../format';
import type { ComplementGroup } from '../types';
import { Badge } from '../ui';
import { useGroups } from '../useMenu';
import { GroupEditor } from './GroupEditor';

const usedBy = (n: number) => (n === 1 ? '1 item' : `${n} itens`);

/** Catálogo → Complementos: the reusable group library (options, prices, codes, usage). */
export function GroupsPage({ editable, realtime }: { editable: boolean; realtime?: Realtime }) {
  const { groups, error, reload } = useGroups(realtime);
  const [q, setQ] = useState(''),
    [editing, setEditing] = useState<ComplementGroup | 'new' | null>(null),
    [deleting, setDeleting] = useState<ComplementGroup | null>(null);
  const visible = groups.filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <SettingsPage>
      <SettingsHeader
        title="Complementos"
        description="Grupos de complementos reutilizáveis (adicionais, ponto da carne, bebidas…). O mínimo e o máximo de escolhas ficam no vínculo com cada item."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar grupos…' }}
        count={`${groups.length} grupo${groups.length === 1 ? '' : 's'}`}
        action={editable && <Button icon={Plus} label="Novo grupo" onClick={() => setEditing('new')} />}
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <Table
        headers={['Grupo', 'Tipo', 'Opções', 'Usado em', '']}
        rows={visible.length}
        empty="Nenhum grupo de complementos."
      >
        {visible.map((g) => (
          <tr key={g.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{g.name}</span>
              {g.status === 'unavailable' && <Badge tone="amber">Pausado</Badge>}
              {g.external_code && <span className="text-xs">PDV {g.external_code}</span>}
            </Cell>
            <Cell>{GROUP_TYPE_LABEL[g.type]}</Cell>
            <Cell>
              <span className="line-clamp-2 text-sm">
                {g.options.map((o) => `${o.product.name} (+${money(o.price_cents)})`).join(', ') || '—'}
              </span>
            </Cell>
            <Cell>{usedBy(g.used_by)}</Cell>
            <Cell className="w-24">
              {editable ? (
                <RowActions labelFor={g.name} onEdit={() => setEditing(g)} onDelete={() => setDeleting(g)} />
              ) : (
                <Button
                  size="sm"
                  color="slate"
                  variant="faded"
                  icon={Eye}
                  aria-label={`Ver ${g.name}`}
                  onClick={() => setEditing(g)}
                />
              )}
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <SidePanel
          title={editing === 'new' ? 'Novo grupo de complementos' : editing.name}
          onClose={() => setEditing(null)}
        >
          <GroupEditor
            group={editing === 'new' ? undefined : editing}
            editable={editable}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        </SidePanel>
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir grupo"
          description={`Excluir “${deleting.name}”? Ele está em ${usedBy(deleting.used_by)}.`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await catalogApi.deleteGroup(deleting.id);
            } catch (e) {
              if (e instanceof ApiError && e.status === 409)
                throw new Error(
                  `Este grupo está em uso em ${usedBy(deleting.used_by)}. Remova-o dos itens antes de excluir.`,
                  { cause: e },
                );
              throw e;
            }
            reload();
          }}
        />
      )}
    </SettingsPage>
  );
}
