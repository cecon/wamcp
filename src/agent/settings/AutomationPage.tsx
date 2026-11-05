import { useCallback, useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Copy, Plus } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { AutomationRule, Catalog } from '../types';
import { ACTIONS, AUTOMATION_EVENTS } from '../labels';
import { SidePanel } from '../ui/Overlay';
import { RowActions, Toggle } from '../ui/Settings';
import { RuleEditor } from './RuleEditor';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

/** Automação no C3Theme (lote 32): regras (Nome | Quando | Ativa) e o painel lateral do editor. */
export function AutomationPage({ catalog }: { catalog: Catalog }) {
  const [rules, setRules] = useState<AutomationRule[]>([]),
    [q, setQ] = useState(''),
    [creating, setCreating] = useState(false);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<AutomationRule[]>('/automation_rules').then(setRules), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const visible = rules.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

  const columns: ColumnDef<AutomationRule>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorFn: (rule) => rule.name,
      cell: (info) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {info.row.original.name}
          </Typography>
          <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block' }}>
            {info.row.original.actions.map((a) => ACTIONS[a.action_name] || a.action_name).join(', ')}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'event',
      header: 'Quando',
      accessorFn: (rule) => AUTOMATION_EVENTS[rule.event_name] || rule.event_name,
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'active',
      header: 'Ativa',
      accessorFn: (rule) => (rule.active ? 'Ativa' : 'Inativa'),
      cell: (info) => (
        <Toggle
          compact
          label={`Ativa ${info.row.original.name}`}
          checked={Boolean(info.row.original.active)}
          onChange={(active) =>
            void run(async () => {
              await http(`/automation_rules/${info.row.original.id}`, 'PATCH', { active });
              await load();
            })
          }
        />
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton
            size="small"
            aria-label={`Clonar ${info.row.original.name}`}
            title="Clonar"
            onClick={() =>
              void run(async () => {
                await http(`/automation_rules/${info.row.original.id}/clone`, 'POST');
                await load();
              })
            }
          >
            <Copy size={16} />
          </IconButton>
          <RowActions
            labelFor={info.row.original.name}
            onDelete={() =>
              void run(async () => {
                await http(`/automation_rules/${info.row.original.id}`, 'DELETE');
                await load();
              })
            }
          />
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Automação"
        description="Regras rodam após cada evento e executam ações como atribuir, etiquetar ou responder. Ações feitas por uma regra não disparam outras regras."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar automações…' }}
        count={`${rules.length} regra${rules.length === 1 ? '' : 's'}`}
        action={
          <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Criar automação
          </Button>
        }
      />
      {error && !creating && <SettingsC3Error>{error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(rule) => String(rule.id)}
          empty="Nenhuma automação ainda."
          ariaLabel="Automação"
        />
      </Panel>
      {creating && (
        <SidePanel title="Criar automação" onClose={() => setCreating(false)}>
          <RuleEditor
            catalog={catalog}
            busy={busy}
            error={error}
            onCancel={() => setCreating(false)}
            onSave={(rule) =>
              void run(async () => {
                await http('/automation_rules', 'POST', rule);
                setCreating(false);
                await load();
              })
            }
          />
        </SidePanel>
      )}
    </SettingsC3Page>
  );
}
