import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { KeyRound, Send } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import { ActivityPanel } from './ActivityPanel';
import { AskModal } from './AskModal';
import { PermissionsPanel } from './PermissionsPanel';
import { StatusPill } from './StatusPill';
import { isFinal, type EngineActivity } from './types';

/** The agentic engine: requests given to AI agents, how they delegated, what they used and what it cost. */
export function EnginePage() {
  const activities = useFetch<EngineActivity[]>('/engine/activities');
  const roster = useFetch<RosterAgent[]>('/agent_directory');
  const [open, setOpen] = useState<number | null>(null),
    [asking, setAsking] = useState(false),
    [permissions, setPermissions] = useState(false);
  const list = (activities.data || []).filter((a) => a.parent_id === null);
  const ai = (roster.data || []).filter((a) => a.kind === 'ai' && a.active);
  const name = (id: number) => roster.data?.find((a) => a.id === id)?.name || `#${id}`;
  const busy = list.some((a) => !isFinal(a.status));
  const reload = activities.reload;

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(reload, 3000);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  const columns: ColumnDef<EngineActivity>[] = [
    {
      id: 'id',
      header: '#',
      accessorKey: 'id',
      cell: (info) => (
        <Typography variant="caption" color="text.secondary">
          {info.row.original.id}
        </Typography>
      ),
    },
    {
      id: 'agent',
      header: 'Agente',
      accessorFn: (activity) => name(activity.agent_id),
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'request',
      header: 'Pedido',
      accessorKey: 'request',
      cell: (info) => (
        <Button
          variant="text"
          size="small"
          onClick={() => setOpen(info.row.original.id)}
          sx={{ justifyContent: 'flex-start', textAlign: 'start', p: 0 }}
        >
          {info.row.original.request}
        </Button>
      ),
    },
    {
      id: 'status',
      header: 'Situação',
      accessorFn: (activity) => activity.status,
      cell: (info) => <StatusPill status={info.row.original.status} />,
    },
    {
      id: 'updated',
      header: 'Atualizado',
      accessorFn: (activity) => activity.updated,
      cell: (info) => (
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          {new Date(info.row.original.updated).toLocaleString('pt-BR')}
        </Typography>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Motor de agentes"
        description="Pedidos feitos aos agentes de IA: quem recebeu, para quem delegou, quais ferramentas usou, com que evidência respondeu e quanto consumiu. Tudo fica registrado e sobrevive a reinícios."
        count={`${list.length} pedido${list.length === 1 ? '' : 's'}`}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<KeyRound size={16} />}
              onClick={() => setPermissions(true)}
            >
              Permissões
            </Button>
            <Button
              variant="contained"
              startIcon={<Send size={16} />}
              disabled={ai.length === 0}
              onClick={() => setAsking(true)}
            >
              Novo pedido
            </Button>
          </Stack>
        }
      />
      {(activities.error || roster.error) && (
        <SettingsC3Error>{activities.error || roster.error}</SettingsC3Error>
      )}
      <Panel flush>
        {list.length === 0 && activities.data && (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Nenhum pedido ainda.
            </Typography>
          </Box>
        )}
        {!activities.data && (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Carregando…
            </Typography>
          </Box>
        )}
        {list.length > 0 && (
          <DataTable
            rows={list}
            columns={columns}
            getRowId={(activity) => String(activity.id)}
            paginate={list.length > 10}
            ariaLabel="Motor de agentes"
          />
        )}
      </Panel>
      {open !== null && (
        <ActivityPanel id={open} name={name} onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {asking && (
        <AskModal
          agents={ai}
          onClose={() => setAsking(false)}
          onStarted={(id) => {
            reload();
            setOpen(id);
          }}
        />
      )}
      {permissions && <PermissionsPanel agents={ai} onClose={() => setPermissions(false)} />}
    </SettingsC3Page>
  );
}
