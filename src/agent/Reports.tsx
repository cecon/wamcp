import { useEffect, useState, type ReactNode } from 'react';
import { duration, http, query } from './api';
import type { Catalog } from './types';
import { Cell, SettingsPage, Table } from './ui/Settings';

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

/** Chatwoot MetricCard: rounded card, title, optional LIVE chip, then label/value metrics. */
function MetricCard({ title, live, children }: { title: string; live?: boolean; children: ReactNode }) {
  return (
    <section className="flex min-h-[10rem] flex-col gap-4 rounded-xl bg-n-solid-2 px-6 py-5 shadow outline outline-1 -outline-offset-1 outline-n-container">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium text-n-slate-12">{title}</h2>
        {live && (
          <span className="flex items-center gap-1 rounded bg-n-teal-3 px-2 py-0.5 text-xs text-n-teal-11">
            <span className="size-1 rounded-full bg-n-teal-9" /> AO VIVO
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-10 gap-y-4">{children}</div>
    </section>
  );
}
const Metric = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <p className="text-base text-n-slate-11">{label}</p>
    <p className="text-3xl text-n-slate-12">{value}</p>
  </div>
);

export function Reports({ catalog }: { catalog: Catalog }) {
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
  const status = (value: string) => catalog.agents.filter((a) => a.active && a.availability === value).length;

  return (
    <SettingsPage>
      <header className="flex flex-wrap items-center justify-between gap-3 pt-2 pb-1">
        <h1 className="text-heading-1">Visão geral</h1>
        <div className="flex gap-2">
          <select
            aria-label="Período"
            className="field !h-8 !w-44 !py-1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Últimas 24 horas</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
          <select
            aria-label="Caixa de entrada"
            className="field !h-8 !w-44 !py-1"
            value={inboxId}
            onChange={(e) => setInboxId(e.target.value)}
          >
            <option value="">Todas as caixas</option>
            {catalog.inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <div className="flex flex-col gap-4 md:flex-row">
        {summary && (
          <div className="md:w-[65%]">
            <MetricCard title="Conversas">
              <Metric label="Criadas" value={summary.conversations} />
              <Metric
                label="Recebidas / enviadas"
                value={`${summary.incoming_messages} / ${summary.outgoing_messages}`}
              />
              <Metric label="1ª resposta (média)" value={duration(summary.first_response.average)} />
              <Metric
                label={`Resolução · ${summary.resolutions.count} resolvidas`}
                value={duration(summary.resolutions.average)}
              />
              <Metric label={`CSAT · ${summary.csat.count} respostas`} value={score(summary.csat.average)} />
            </MetricCard>
          </div>
        )}
        <div className="md:w-[35%]">
          <MetricCard title="Status dos agentes" live>
            <Metric label="Online" value={status('online')} />
            <Metric label="Ocupados" value={status('busy')} />
            <Metric label="Offline" value={status('offline')} />
          </MetricCard>
        </div>
      </div>
      <section className="rounded-xl bg-n-solid-2 px-6 py-5 shadow outline outline-1 -outline-offset-1 outline-n-container">
        <h2 className="mb-2 text-lg font-medium">Desempenho por agente</h2>
        <Table
          headers={['Agente', 'Resolvidas', '1ª resposta', 'Resolução', 'CSAT']}
          rows={agents.length}
          empty="Sem dados no período."
        >
          {agents.map((a) => (
            <tr key={a.id}>
              <Cell className="font-medium text-n-slate-12">{a.name}</Cell>
              <Cell>{a.resolved}</Cell>
              <Cell>{duration(a.avg_first_response)}</Cell>
              <Cell>{duration(a.avg_resolution)}</Cell>
              <Cell>{score(a.csat)}</Cell>
            </tr>
          ))}
        </Table>
      </section>
      <section className="rounded-xl bg-n-solid-2 px-6 py-5 shadow outline outline-1 -outline-offset-1 outline-n-container">
        <h2 className="mb-2 text-lg font-medium">Avaliações recentes (CSAT)</h2>
        <Table
          headers={['Nota', 'Conversa', 'Responsável', 'Comentário']}
          rows={csat.length}
          empty="Nenhuma avaliação no período."
        >
          {csat.map((r) => (
            <tr key={r.id}>
              <Cell>
                <span
                  className={`inline-flex size-7 items-center justify-center rounded-lg text-white ${r.rating >= 4 ? 'bg-n-teal-9' : r.rating >= 3 ? 'bg-n-amber-9' : 'bg-n-ruby-9'}`}
                >
                  {r.rating}
                </span>
              </Cell>
              <Cell className="text-n-slate-12">
                #{r.display_id} · {r.contact_name || 'Contato'}
              </Cell>
              <Cell>{r.assignee_name || 'Sem responsável'}</Cell>
              <Cell>{r.feedback ? `“${r.feedback}”` : '—'}</Cell>
            </tr>
          ))}
        </Table>
      </section>
    </SettingsPage>
  );
}
