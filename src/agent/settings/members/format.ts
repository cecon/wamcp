import type { RosterAgent, Salary, UsageDay } from '../../adminTypes';
import { phone } from '../directory/labels';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const COUNT = new Intl.NumberFormat('pt-BR');

export const brl = (value: number) => BRL.format(value);
export const usd = (value: number) => USD.format(value);
export const count = (value: number) => COUNT.format(value);

/** "R$ 50,00/mês" for a person's seat; an AI agent's month-to-date earnings ("R$ 0,33 no mês"). */
export function salaryLabel(agent: Pick<RosterAgent, 'kind'>, salary: Salary | undefined) {
  if (!salary) return '—';
  return agent.kind === 'ai' ? `${brl(salary.salary_brl)} no mês` : `${brl(salary.salary_brl)}/mês`;
}

/** Cost of 1 000 tokens this month with the margin, in reais (`null` before the first priced call). */
export function costPerThousand(salary: Salary | undefined) {
  const tokens = salary ? salary.input_tokens + salary.output_tokens : 0;
  if (!salary || tokens === 0 || salary.salary_brl === 0) return null;
  return (salary.salary_brl / tokens) * 1000;
}

/**
 * The full body of `PUT /agent_directory/{id}` (it replaces every field), with `changes` applied:
 * used to move an agent in the hierarchy or switch it on and off without the form.
 */
export function agentBody(agent: RosterAgent, changes: Partial<RosterAgent> = {}) {
  const next = { ...agent, ...changes };
  const common = {
    name: next.name,
    kind: next.kind,
    profile_id: next.profile_id,
    description: next.description,
    active: next.active,
    supervisor_id: next.supervisor_id ?? null,
  };
  if (next.kind === 'human')
    return { ...common, user_id: next.user_id, whatsapp: phone(next.whatsapp_jid) || null };
  return { ...common, runtime: next.runtime, model: next.model, instructions: next.instructions };
}

/** Skills of the agent: its own and the ones inherited from the profile, without repeats. */
export const skillIdsOf = (agent: RosterAgent) => [
  ...new Set([...(agent.profile_skill_ids || []), ...agent.skill_ids]),
];

export type Status = { label: string; tone: 'online' | 'busy' | 'offline' };

/** People with a login show their availability; AI agents are on while active. */
export function statusOf(agent: RosterAgent): Status {
  if (!agent.active) return { label: 'Inativo', tone: 'offline' };
  if (agent.kind === 'ai') return { label: 'Ativo', tone: 'online' };
  if (agent.availability === 'online') return { label: 'Online', tone: 'online' };
  if (agent.availability === 'busy') return { label: 'Ocupado', tone: 'busy' };
  return { label: 'Offline', tone: 'offline' };
}

const DAY_MS = 86_400_000;

/** The last `days` days (UTC, oldest first), with zeros for days without calls. */
export function fillDays(usage: UsageDay[], days: number, now = Date.now()) {
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(now - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    return usage.find((u) => u.day === day) ?? { day, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  });
}
