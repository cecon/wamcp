import { useState, type ReactNode } from 'react';
import { Brain, Pencil, X } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent, Salary, SalaryRates, Skill, UsageDay } from '../../adminTypes';
import type { Inbox } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { Toggle } from '../../ui/Settings';
import { useAction } from '../useAction';
import { phone, roleLabel, runtimeLabel } from '../directory/labels';
import { AvatarEditor } from './AvatarEditor';
import { MemberAvatar } from './MemberAvatar';
import { UsageChart } from './UsageChart';
import { agentBody, brl, costPerThousand, count, salaryLabel, skillIdsOf, statusOf, usd } from './format';

const TABS = ['Visão Geral', 'Habilidades', 'Memória', 'Ferramentas', 'Configurações'] as const;
type Tab = (typeof TABS)[number];

interface Props {
  agent: RosterAgent;
  roster: RosterAgent[];
  skills: Skill[];
  salary: Salary | undefined;
  rates: SalaryRates | undefined;
  inboxes: Inbox[];
  onEdit: () => void;
  onClose: () => void;
  onChanged: () => void;
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title} className="rounded-xl bg-n-alpha-2 p-4">
    <h3 className="mb-2 text-xs font-medium tracking-wide text-n-slate-11 uppercase">{title}</h3>
    {children}
  </section>
);

/** Detail pane of a member: overview (salary, model, usage), skills, memory, tools and settings. */
export function MemberDetail(props: Props) {
  const { agent, skills, onEdit, onClose } = props;
  const [tab, setTab] = useState<Tab>('Visão Geral');
  const status = statusOf(agent);
  return (
    <aside
      aria-label={`Detalhes de ${agent.name}`}
      className="flex flex-col gap-4 rounded-xl bg-n-solid-2 p-5 outline outline-1 -outline-offset-1 outline-n-weak"
    >
      <header className="flex items-start gap-3">
        <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-n-slate-12">{agent.name}</h2>
          <p className="text-sm text-n-slate-11">
            {[...new Set([agent.profile_name, agent.role && roleLabel(agent.role)])]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-xs text-n-slate-11">
            {agent.kind === 'ai' ? 'Agente de IA' : 'Humano'} · {status.label}
          </p>
        </div>
        <Button color="slate" variant="faded" icon={Pencil} aria-label="Editar cadastro" onClick={onEdit} />
        <Button color="slate" variant="ghost" icon={X} aria-label="Fechar detalhes" onClick={onClose} />
      </header>
      {agent.description && (
        <p className="rounded-xl bg-n-alpha-2 px-3 py-2 text-sm text-n-slate-12">“{agent.description}”</p>
      )}
      <div role="tablist" aria-label="Seções" className="flex gap-1 overflow-x-auto border-b border-n-weak">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-2 py-1.5 text-sm whitespace-nowrap',
              tab === t
                ? 'border-n-brand text-n-slate-12'
                : 'border-transparent text-n-slate-11 hover:text-n-slate-12',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="flex flex-col gap-3">
        {tab === 'Visão Geral' && <Overview {...props} />}
        {tab === 'Habilidades' && <Skills agent={agent} skills={skills} />}
        {tab === 'Memória' && (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-n-slate-11">
            <Brain size={28} className="text-n-slate-10" />
            {agent.kind === 'ai'
              ? 'A memória própria do agente (lembrar e consultar fatos de clientes e conversas) chega com o runtime agêntico. Ela vai aparecer aqui, com a opção de apagar cada item.'
              : 'Pessoas não têm memória gravada no app.'}
          </div>
        )}
        {tab === 'Ferramentas' && <Tools agent={agent} skills={skills} />}
        {tab === 'Configurações' && <Settings {...props} />}
      </div>
    </aside>
  );
}

function Overview({ agent, salary, rates, inboxes }: Props) {
  const { data: usage } = useFetch<UsageDay[]>(
    agent.kind === 'ai' ? `/agent_directory/${agent.id}/usage?days=30` : null,
  );
  const perThousand = costPerThousand(salary);
  const serves = inboxes.filter((i) => i.ai_agent_id === agent.id);
  return (
    <>
      <Card title="Salário digital">
        <p className="text-2xl font-semibold text-n-slate-12">{salaryLabel(agent, salary)}</p>
        <p className="mt-1 text-xs text-n-slate-11">
          {agent.kind === 'ai'
            ? `Começa o mês em R$ 0 e acumula o custo dos tokens de cada tarefa${
                rates ? ` com ${rates.ai_margin_percent}% de margem (US$ 1 = ${brl(rates.usd_brl_rate)})` : ''
              }.`
            : agent.active
              ? 'Assento fixo por pessoa ativa.'
              : 'Pessoas inativas não ocupam assento.'}
        </p>
        {salary && salary.unpriced_calls > 0 && (
          <p className="mt-1 text-xs text-n-amber-11">
            {salary.unpriced_calls} chamada(s) sem custo informado pelo runtime não entram no salário.
          </p>
        )}
      </Card>
      {agent.kind === 'ai' && (
        <>
          <Card title="Modelo">
            <p className="text-sm text-n-slate-12">
              {runtimeLabel(agent.runtime)}
              {agent.model ? ` · ${agent.model}` : ' · modelo padrão'}
            </p>
            <p className="mt-1 text-xs text-n-slate-11">
              {perThousand === null
                ? 'Custo por 1 mil tokens: aparece depois da primeira tarefa com custo informado.'
                : `Custo por 1 mil tokens neste mês: ${brl(perThousand)} (com a margem).`}
            </p>
          </Card>
          <Card title="Uso de tokens (30 dias)">
            <div className="mb-2 flex gap-4 text-sm">
              <span>
                <span className="block text-xs text-n-slate-11">Entrada no mês</span>
                {count(salary?.input_tokens ?? 0)}
              </span>
              <span>
                <span className="block text-xs text-n-slate-11">Saída no mês</span>
                {count(salary?.output_tokens ?? 0)}
              </span>
              <span>
                <span className="block text-xs text-n-slate-11">Custo bruto</span>
                {usd(salary?.cost_usd ?? 0)}
              </span>
            </div>
            <UsageChart usage={usage || []} />
          </Card>
          <Card title="Atende">
            {serves.length ? (
              <ul className="text-sm text-n-slate-12">
                {serves.map((i) => (
                  <li key={i.id}>{i.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-n-slate-11">Nenhuma caixa de entrada.</p>
            )}
          </Card>
        </>
      )}
      {agent.kind === 'human' && (
        <Card title="Contato">
          <p className="text-sm text-n-slate-12">
            {[agent.user_email, phone(agent.whatsapp_jid)].filter(Boolean).join(' · ') || '—'}
          </p>
        </Card>
      )}
    </>
  );
}

function Skills({ agent, skills }: { agent: RosterAgent; skills: Skill[] }) {
  const ids = skillIdsOf(agent);
  if (!ids.length) return <p className="text-sm text-n-slate-11">Nenhuma skill.</p>;
  const inherited = new Set(agent.profile_skill_ids || []);
  return (
    <ul className="flex flex-col gap-2">
      {ids.map((id) => {
        const skill = skills.find((s) => s.id === id);
        if (!skill) return null;
        return (
          <li key={id} className="rounded-lg bg-n-alpha-2 px-3 py-2">
            <span className="text-sm font-medium text-n-slate-12">{skill.name}</span>
            {inherited.has(id) && (
              <span className="ms-2 rounded bg-n-slate-4 px-1 text-xs text-n-slate-11">do perfil</span>
            )}
            {skill.description && <p className="text-xs text-n-slate-11">{skill.description}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Tools({ agent, skills }: { agent: RosterAgent; skills: Skill[] }) {
  const owned = skillIdsOf(agent)
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is Skill => Boolean(s));
  const tools = [...new Set(owned.flatMap((s) => s.tools))].sort();
  return (
    <>
      {tools.length ? (
        <ul className="flex flex-wrap gap-1">
          {tools.map((tool) => (
            <li key={tool} className="rounded-md bg-n-alpha-2 px-2 py-0.5 font-mono text-xs text-n-slate-12">
              {tool}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-n-slate-11">As skills deste agente não liberam ferramentas.</p>
      )}
      {agent.kind === 'ai' && (
        <p className="text-xs text-n-slate-11">
          {agent.credential_count
            ? `${agent.credential_count} credencial(is) usada(s) pelas ferramentas no servidor; edite o cadastro para gerenciá-las.`
            : 'Sem credenciais.'}
        </p>
      )}
    </>
  );
}

function Settings({ agent, roster, onChanged }: Props) {
  const { error, busy, run } = useAction();
  const save = (changes: Partial<RosterAgent>) =>
    run(async () => {
      await http(`/agent_directory/${agent.id}`, 'PUT', agentBody(agent, changes));
      onChanged();
    });
  return (
    <>
      <label>
        <span className="field-label">Responde a</span>
        <select
          className="field"
          disabled={busy}
          value={agent.supervisor_id ? String(agent.supervisor_id) : ''}
          onChange={(e) => void save({ supervisor_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Ninguém (topo da organização)</option>
          {roster
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.role ? ` — ${roleLabel(a.role)}` : ''}
              </option>
            ))}
        </select>
      </label>
      <Toggle
        label="Ativo"
        hint={
          agent.kind === 'ai'
            ? 'Inativo, o agente não atende nem recebe tarefas.'
            : 'Inativa, a pessoa não ocupa assento.'
        }
        checked={agent.active}
        onChange={(active) => void save({ active })}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <AvatarEditor key={agent.id} agent={agent} onSaved={onChanged} />
    </>
  );
}
