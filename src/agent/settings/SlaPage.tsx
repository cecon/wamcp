import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Pencil, Plus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog, Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { SlaPolicy } from '../parityTypes';
import { formatSeconds } from '../reports/metrics';
import { THRESHOLDS, useSlaPolicies } from '../sla/sla';
import { SlaModal } from './SlaModal';
import { SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

/** Configurações → SLA no C3Theme (lote 4): lista/cabeçalho/confirmação; o editor de SLA segue o do app. */
export function SlaPage() {
  const { policies, error, reload } = useSlaPolicies();
  const [editing, setEditing] = useState<SlaPolicy | 'new' | null>(null),
    [removing, setRemoving] = useState<SlaPolicy | null>(null);
  const count = `${policies.length} SLA${policies.length === 1 ? '' : 's'}`;

  const columns: ColumnDef<SlaPolicy>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorKey: 'name',
      cell: (info) => (
        <Stack>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {info.row.original.name}
          </Typography>
          {info.row.original.description && (
            <Typography variant="caption" color="text.secondary">
              {info.row.original.description}
            </Typography>
          )}
        </Stack>
      ),
    },
    ...THRESHOLDS.map<ColumnDef<SlaPolicy>>(({ key, label }) => ({
      id: key,
      header: label,
      accessorFn: (policy) => formatSeconds(policy[key]),
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    })),
    {
      id: 'actions',
      header: '',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton
            size="small"
            aria-label={`Editar ${info.row.original.name}`}
            onClick={() => setEditing(info.row.original)}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={`Excluir ${info.row.original.name}`}
            onClick={() => setRemoving(info.row.original)}
          >
            <Trash2 size={14} />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="SLA"
        description="Acordos de nível de serviço definem prazos de primeira resposta, próxima resposta e resolução. Aplique-os nas conversas, por automações ou por macros."
        count={count}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Adicionar SLA
          </Button>
        }
      />
      {error && (
        <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      )}
      <Panel flush>
        <DataTable
          rows={policies}
          columns={columns}
          getRowId={(policy) => String(policy.id)}
          paginate={policies.length > 10}
          empty="Nenhum SLA ainda."
          ariaLabel="SLA"
        />
      </Panel>
      {editing && (
        <SlaModal
          policy={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {removing && (
        <ActionDialog
          open
          title={`Excluir o SLA “${removing.name}”?`}
          description="Conversas que já usam este SLA deixam de ser acompanhadas."
          confirmLabel="Excluir"
          backLabel="Cancelar"
          tone="danger"
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            void http(`/sla_policies/${removing.id}`, 'DELETE')
              .then(() => reload())
              .then(() => setRemoving(null))
          }
        />
      )}
    </SettingsC3Page>
  );
}
