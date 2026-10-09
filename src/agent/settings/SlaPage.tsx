import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { SlaPolicy } from '../parityTypes';
import { formatSeconds } from '../reports/metrics';
import { THRESHOLDS, useSlaPolicies } from '../sla/sla';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../ui/Settings';
import { SlaModal } from './SlaModal';

/** Chatwoot SLA settings: policies with their targets, plus the add/edit modal and delete confirmation. */
export function SlaPage() {
  const { policies, error, reload } = useSlaPolicies();
  const [editing, setEditing] = useState<SlaPolicy | 'new' | null>(null),
    [removing, setRemoving] = useState<SlaPolicy | null>(null);
  return (
    <SettingsPage>
      <SettingsHeader
        title="SLA"
        description="Acordos de nível de serviço definem prazos de primeira resposta, próxima resposta e resolução. Aplique-os nas conversas, por automações ou por macros."
        count={`${policies.length} SLA${policies.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar SLA" onClick={() => setEditing('new')} />}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={['Nome', ...THRESHOLDS.map((t) => t.label), '']}
        rows={policies.length}
        empty="Nenhum SLA ainda."
      >
        {policies.map((p) => (
          <tr key={p.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{p.name}</span>
              {p.description && <span className="text-sm">{p.description}</span>}
            </Cell>
            {THRESHOLDS.map(({ key }) => (
              <Cell key={key}>{formatSeconds(p[key])}</Cell>
            ))}
            <Cell className="w-24">
              <RowActions labelFor={p.name} onEdit={() => setEditing(p)} onDelete={() => setRemoving(p)} />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <SlaModal
          policy={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir o SLA “${removing.name}”?`}
          description="Conversas que já usam este SLA deixam de ser acompanhadas."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/sla_policies/${removing.id}`, 'DELETE');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}
