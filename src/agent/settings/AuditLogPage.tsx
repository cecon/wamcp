import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { http, query } from '../api';
import type { AuditLog } from '../accountTypes';
import { formatDateTime } from '../profile/browser';
import { Button } from '../ui/Button';
import { Cell, SettingsHeader, SettingsPage, Table } from '../ui/Settings';

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

/** Chatwoot "Auditoria": who changed what, from which IP and when (50 per page). */
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

  return (
    <SettingsPage>
      <SettingsHeader
        title="Registro de auditoria"
        description="Acompanhe os acessos e as alterações administrativas feitas na conta: agentes, times, caixas, automações, macros, webhooks e mais."
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <Table
        headers={['Usuário', 'Ação', 'Tipo', 'ID', 'Endereço IP', 'Data']}
        rows={items.length}
        empty={logs ? 'Nenhum registro nesta página.' : 'Carregando…'}
      >
        {items.map((log) => (
          <tr key={log.id}>
            <Cell>
              <span className="font-medium text-n-slate-12">{log.user_name || 'Sistema'}</span>
            </Cell>
            <Cell>
              <span title={log.details?.path ? `${log.details.method} ${log.details.path}` : undefined}>
                {label(ACTION, log.action)}
              </span>
            </Cell>
            <Cell>{label(TYPE, log.auditable_type)}</Cell>
            <Cell>{log.auditable_id ?? '—'}</Cell>
            <Cell>{log.ip_address || '—'}</Cell>
            <Cell>{formatDateTime(log.created_at)}</Cell>
          </tr>
        ))}
      </Table>
      <nav aria-label="Paginação" className="flex items-center justify-end gap-2 text-sm text-n-slate-11">
        <Button
          color="slate"
          variant="faded"
          size="sm"
          icon={ChevronLeft}
          label="Anterior"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        />
        <span>Página {page}</span>
        <Button
          color="slate"
          variant="faded"
          size="sm"
          trailingIcon={ChevronRight}
          label="Próxima"
          disabled={items.length < PER_PAGE}
          onClick={() => setPage((p) => p + 1)}
        />
      </nav>
    </SettingsPage>
  );
}
