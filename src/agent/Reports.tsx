import { useEffect, useState } from 'react';
import { duration, http, query } from './api';
import type { Inbox } from './types';

interface Average {
  count: number;
  average: number | null;
}
interface Summary {
  conversations: number;
  incoming_messages: number;
  outgoing_messages: number;
  first_response: Average;
  resolutions: Average;
  csat: Average;
}
interface AgentRow {
  id: number;
  name: string;
  resolved: number;
  avg_first_response: number | null;
  avg_resolution: number | null;
  csat: number | null;
}
interface CsatRow {
  id: number;
  display_id: number;
  contact_name: string | null;
  assignee_name: string | null;
  rating: number;
  feedback: string | null;
}

const score = (value: number | null | undefined) => (value == null ? '—' : value.toFixed(1));

export function Reports({ inboxes }: { inboxes: Inbox[] }) {
  const [days, setDays] = useState(7),
    [inboxId, setInboxId] = useState(''),
    [summary, setSummary] = useState<Summary | null>(null),
    [agents, setAgents] = useState<AgentRow[]>([]),
    [csat, setCsat] = useState<CsatRow[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    const q = query({ since: now - days * 86400, until: now + 1, inbox_id: inboxId });
    Promise.all([
      http<Summary>(`/reports/summary${q}`),
      http<AgentRow[]>(`/reports/agents${q}`),
      http<CsatRow[]>(`/csat_responses${q}`),
    ])
      .then(([s, a, c]) => {
        setSummary(s);
        setAgents(a);
        setCsat(c);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [days, inboxId]);
  return (
    <div className="settings-page">
      <header className="reports-header">
        <h1>Relatórios</h1>
        <div className="list-filters">
          <select aria-label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Últimas 24 horas</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
          <select aria-label="Caixa de entrada" value={inboxId} onChange={(e) => setInboxId(e.target.value)}>
            <option value="">Todas as caixas</option>
            {inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="form-error">{error}</p>}
        {summary && (
          <div className="kpis">
            <div className="kpi">
              <small>Conversas</small>
              <strong>{summary.conversations}</strong>
            </div>
            <div className="kpi">
              <small>Mensagens recebidas / enviadas</small>
              <strong>
                {summary.incoming_messages} / {summary.outgoing_messages}
              </strong>
            </div>
            <div className="kpi">
              <small>Primeira resposta (média)</small>
              <strong>{duration(summary.first_response.average)}</strong>
            </div>
            <div className="kpi">
              <small>Resolução (média) · {summary.resolutions.count} resolvidas</small>
              <strong>{duration(summary.resolutions.average)}</strong>
            </div>
            <div className="kpi">
              <small>CSAT · {summary.csat.count} respostas</small>
              <strong>{score(summary.csat.average)}</strong>
            </div>
          </div>
        )}
        <div className="settings-grid">
          <section className="panel">
            <h2>Por agente</h2>
            <table>
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Resolvidas</th>
                  <th>1ª resposta</th>
                  <th>Resolução</th>
                  <th>CSAT</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.resolved}</td>
                    <td>{duration(a.avg_first_response)}</td>
                    <td>{duration(a.avg_resolution)}</td>
                    <td>{score(a.csat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>Avaliações recentes</h2>
            {csat.length === 0 && <p className="muted">Nenhuma avaliação no período.</p>}
            <ul className="plain-list">
              {csat.map((r) => (
                <li key={r.id} className="row">
                  <b className={`rating r${r.rating}`}>{r.rating}</b>
                  <span>
                    <strong>
                      #{r.display_id} · {r.contact_name || 'Contato'}
                    </strong>
                    <small>
                      {r.assignee_name || 'Sem responsável'}
                      {r.feedback ? ` · “${r.feedback}”` : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
