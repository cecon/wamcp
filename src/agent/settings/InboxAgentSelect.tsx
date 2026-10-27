import { http } from '../api';
import type { RosterAgent } from '../adminTypes';
import type { Inbox } from '../types';
import { useFetch } from '../useFetch';
import { useAction } from './useAction';
import { executes, runtimeLabel } from './directory/labels';

interface Props {
  inbox: Inbox;
  onChange: () => Promise<void>;
}

/** Inbox setting "Agente de IA": the AI agent that answers new conversations through its runtime. */
export function InboxAgentSelect({ inbox, onChange }: Props) {
  const { data } = useFetch<RosterAgent[]>('/agent_directory');
  const { error, busy, run } = useAction();
  const agents = (data || []).filter(
    (a) => a.kind === 'ai' && ((a.active && executes(a.role)) || a.id === inbox.ai_agent_id),
  );
  const connect = (value: string) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}/ai_agent`, 'POST', { ai_agent_id: value ? Number(value) : null });
      await onChange();
    });

  return (
    <label className="block border-t border-n-weak py-3">
      <span className="text-heading-3 block text-n-slate-12">Agente de IA</span>
      <span className="mb-2 block text-sm text-n-slate-11">
        O agente responde as conversas novas pelo runtime e modelo do seu cadastro, com as suas instruções e
        skills. Elas ficam “Pendente” até ele transferir para a equipe. Conversas que já estão abertas
        continuam com quem as assumiu: para entregar uma ao agente, use “Passar para a IA” no menu de status
        da conversa. Coordenadores não atendem: só delegam.
      </span>
      <select
        className="field"
        aria-label="Agente de IA"
        disabled={busy}
        value={inbox.ai_agent_id ? String(inbox.ai_agent_id) : ''}
        onChange={(e) => void connect(e.target.value)}
      >
        <option value="">Nenhum</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {[agent.name, runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>
      {error && <span className="mt-1 block text-sm text-n-ruby-11">{error}</span>}
    </label>
  );
}
