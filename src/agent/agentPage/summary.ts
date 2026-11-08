import type { AgentRun } from '../agentRuns/types';
import { isFinal, type EngineActivity } from '../settings/engine/types';
import type { AgentHistory } from './types';

/** O que a página resume: o histórico do período, os pedidos do motor do agente e o agora. */
export interface SummaryInput {
  history: AgentHistory | null;
  /** Pedidos do motor deste agente (de qualquer nível da delegação). */
  activities: EngineActivity[];
  runs: AgentRun[];
  paused: boolean;
  /** Salário do mês até agora, em reais (com a margem). */
  monthBrl: number | null;
  now: number;
}

/** Algo que espera por uma pessoa, do mais urgente ao menos. */
export interface AttentionItem {
  key: string;
  kind: 'paused' | 'approval' | 'error' | 'handoff';
  title: string;
  detail: string | null;
  /** Milissegundos desde a época (ordena os itens do mesmo tipo). */
  at: number;
  activityId?: number;
  displayId?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Junta partes em português: "a", "a e b", "a, b e c". */
export function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** Pedidos do motor dentro do período da página (pela criação). */
export function inWindow(activities: EngineActivity[], days: number, now: number) {
  const since = now - days * 86_400_000;
  return activities.filter((a) => Date.parse(a.created) >= since);
}

/** O resumo do topo da página, em frases curtas: o que importa, não tudo. */
export function summarize(input: SummaryInput): string[] {
  const { history, runs, paused, monthBrl, now } = input;
  const sentences: string[] = [];
  if (paused) sentences.push('Está pausado: não responde conversas nem começa pedidos até ser retomado.');
  else if (runs.length)
    sentences.push(`Agora está trabalhando em ${plural(runs.length, 'sessão', 'sessões')}.`);
  else sentences.push('Agora está livre.');
  if (!history) return sentences;
  const period = history.days === 1 ? 'Hoje' : `Nos últimos ${history.days} dias`;
  const conversations = history.conversations.length;
  const handoffs = history.conversations.filter((c) => c.handed_to).length;
  if (conversations) {
    const passed = handoffs
      ? ` e passou ${handoffs} para pessoas`
      : ', sem precisar passar nenhuma para pessoas';
    sentences.push(`${period}, atendeu ${plural(conversations, 'conversa', 'conversas')}${passed}.`);
  } else sentences.push(`${period}, não atendeu conversas.`);
  const roots = inWindow(input.activities, history.days, now).filter((a) => a.parent_id === null);
  if (roots.length) {
    const count = (status: string) => roots.filter((a) => a.status === status).length;
    const parts = [
      count('completed') && plural(count('completed'), 'concluído', 'concluídos'),
      count('failed') && plural(count('failed'), 'falhou', 'falharam'),
      count('cancelled') && plural(count('cancelled'), 'cancelado', 'cancelados'),
      roots.filter((a) => !isFinal(a.status)).length &&
        plural(roots.filter((a) => !isFinal(a.status)).length, 'em aberto', 'em aberto'),
    ].filter((p): p is string => Boolean(p));
    sentences.push(`Recebeu ${plural(roots.length, 'pedido', 'pedidos')} no motor: ${joinPt(parts)}.`);
  }
  const ran = history.schedule_runs.filter((r) => r.status !== 'skipped');
  if (ran.length) {
    const failed = ran.filter((r) => r.status === 'failed').length;
    const tail = failed ? `, ${plural(failed, 'falhou', 'falharam')}` : ', todas sem erro';
    sentences.push(`Rodou ${plural(ran.length, 'rotina', 'rotinas')}${tail}.`);
  }
  if (monthBrl !== null) sentences.push(`Neste mês, custou ${brl(monthBrl)} até agora.`);
  return sentences;
}

const ORDER: AttentionItem['kind'][] = ['paused', 'approval', 'error', 'handoff'];

/** O que espera por uma pessoa: pausa, aprovações, erros e as conversas que ele passou adiante (com o motivo). */
export function attention(input: SummaryInput): AttentionItem[] {
  const { history, paused, now } = input;
  const items: AttentionItem[] = [];
  if (paused) items.push({ key: 'paused', kind: 'paused', title: 'Está pausado', detail: null, at: now });
  for (const a of input.activities.filter((x) => x.status === 'waiting_approval'))
    items.push({
      key: `approval:${a.id}`,
      kind: 'approval',
      title: `Pedido #${a.id} espera a sua aprovação`,
      detail: a.request,
      at: Date.parse(a.updated),
      activityId: a.id,
    });
  if (!history) return sortItems(items);
  for (const a of inWindow(input.activities, history.days, now).filter((x) => x.status === 'failed'))
    items.push({
      key: `failed:${a.id}`,
      kind: 'error',
      title: `Pedido #${a.id} falhou`,
      detail: a.error ?? a.request,
      at: Date.parse(a.updated),
      activityId: a.id,
    });
  for (const r of history.schedule_runs.filter((x) => x.status === 'failed'))
    items.push({
      key: `run:${r.id}`,
      kind: 'error',
      title: `A rotina “${r.schedule_name}” falhou`,
      detail: r.error,
      at: r.finished_at ?? r.started_at,
    });
  for (const c of history.conversations.filter((x) => x.handed_to))
    items.push({
      key: `handoff:${c.id}`,
      kind: 'handoff',
      title: `Passou a conversa #${c.display_id}${c.contact_name ? ` com ${c.contact_name}` : ''} para ${c.handed_to}`,
      detail: c.handoff_reason ? `Motivo: ${c.handoff_reason}` : null,
      at: (c.handoff_at ?? 0) * 1000,
      displayId: c.display_id,
    });
  return sortItems(items);
}

function sortItems(items: AttentionItem[]) {
  return items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.at - a.at);
}
