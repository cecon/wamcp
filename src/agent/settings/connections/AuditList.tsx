import { useFetch } from '../../useFetch';
import { Cell, Table } from '../../ui/Settings';
import { sessionPath, type AuditEntry } from './model';

/** Atividade tab: recent MCP calls made with this connection's tokens and ChatGPT grants. */
export function AuditList({ id }: { id: string }) {
  const { data, error } = useFetch<AuditEntry[]>(`${sessionPath(id)}/audit`);
  if (error)
    return (
      <p role="alert" className="text-sm text-n-ruby-11">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-n-slate-11">Carregando atividade…</p>;
  return (
    <Table
      headers={['Ação', 'Credencial', 'Quando']}
      empty="As chamadas MCP aparecerão aqui."
      rows={data.length}
    >
      {data.slice(0, 100).map((a, i) => (
        <tr key={i}>
          <Cell>
            <code className="text-n-slate-12">{a.action}</code>
          </Cell>
          <Cell>{a.token_id || '—'}</Cell>
          <Cell>{new Date(a.at).toLocaleString('pt-BR')}</Cell>
        </tr>
      ))}
    </Table>
  );
}
