import { useEffect, useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { ChevronLeft, ChevronRight } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http, query } from '../api';
import type { AuditLog } from '../accountTypes';
import { formatDateTime } from '../profile/browser';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

const PER_PAGE = 50;
const ACTION: Record<string, string> = {
  sign_in: 'Entrou',
  enable_mfa: 'Ativou a verificação em duas etapas',
  disable_mfa: 'Desativou a verificação em duas etapas',
  create: 'Criou',
  update: 'Alterou',
  delete: 'Excluiu',
  clone: 'Clonou',
  merge: 'Mesclou',
  import: 'Importou',
  verify: 'Ativou a verificação em duas etapas',
  remove_mfa: 'Redefiniu a verificação em duas etapas',
  remove_sessions: 'Encerrou sessões',
};
const TYPE: Record<string, string> = {
  user: 'Agente',
  profile: 'Perfil',
  sla_policy: 'SLA',
  team: 'Time',
  inbox: 'Caixa de entrada',
  label: 'Etiqueta',
  canned_response: 'Resposta pronta',
  automation_rule: 'Automação',
  macro: 'Macro',
  webhook: 'Webhook',
  custom_attribute_definition: 'Atributo personalizado',
  account: 'Conta',
  contact: 'Contato',
  conversation: 'Conversa',
};
const label = (map: Record<string, string>, key: string) => map[key] || key.replaceAll('_', ' ');

/** Auditoria no C3Theme (lote 28): quem alterou o quê, de qual IP e quando (50 por página). */
export function AuditLogPage() {
  const [page, setPage] = useState(1),
    [logs, setLogs] = useState<AuditLog[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    http<AuditLog[]>(`/audit_logs${query({ page })}`)
      .then((list) => current && (setLogs(list), setError('')))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [page]);
  const items = logs || [];

  const columns: ColumnDef<AuditLog>[] = [
    {
      id: 'user',
      header: 'Usuário',
      accessorFn: (log) => log.user_name || 'Sistema',
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'action',
      header: 'Ação',
      accessorFn: (log) => label(ACTION, log.action),
      cell: (info) => {
        const details = info.row.original.details;
        return (
          <Typography
            variant="body2"
            component="span"
            title={details?.path ? `${details.method} ${details.path}` : undefined}
          >
            {String(info.getValue())}
          </Typography>
        );
      },
    },
    {
      id: 'type',
      header: 'Tipo',
      accessorFn: (log) => label(TYPE, log.auditable_type),
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'auditable_id',
      header: 'ID',
      accessorFn: (log) => log.auditable_id ?? '—',
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    },
    {
      id: 'ip',
      header: 'Endereço IP',
      accessorFn: (log) => log.ip_address || '—',
      cell: (info) => (
        <Typography variant="caption" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'created_at',
      header: 'Data',
      accessorFn: (log) => formatDateTime(log.created_at),
      cell: (info) => (
        <Typography variant="caption" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Registro de auditoria"
        description="Acompanhe os acessos e as alterações administrativas feitas na conta: agentes, times, caixas, automações, macros, webhooks e mais."
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={items}
          columns={columns}
          getRowId={(log) => String(log.id)}
          empty={logs ? 'Nenhum registro nesta página.' : 'Carregando…'}
          ariaLabel="Registro de auditoria"
        />
      </Panel>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ChevronLeft size={14} />}
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <Typography variant="body2" color="text.secondary">
          Página {page}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          endIcon={<ChevronRight size={14} />}
          disabled={items.length < PER_PAGE}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </Stack>
    </SettingsC3Page>
  );
}
