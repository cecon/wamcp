import { http } from '../../api';
import type { AgentBot } from '../../adminTypes';
import type { Inbox } from '../../types';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';

interface Props {
  inbox: Inbox;
  onChange: () => Promise<void>;
}

/** Inbox setting "Robô de atendimento": connects one agent bot to the inbox (or none). */
export function InboxBotSelect({ inbox, onChange }: Props) {
  const { data } = useFetch<AgentBot[]>('/agent_bots');
  const { error, busy, run } = useAction();
  const connect = (value: string) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}/agent_bot`, 'POST', { agent_bot_id: value ? Number(value) : null });
      await onChange();
    });

  return (
    <label className="block border-t border-n-weak py-3">
      <span className="text-heading-3 block text-n-slate-12">Robô de atendimento</span>
      <span className="mb-2 block text-sm text-n-slate-11">
        Enquanto um robô estiver conectado, as conversas novas começam como “Pendente” até ele transferir para
        a equipe.
      </span>
      <select
        className="field"
        aria-label="Robô de atendimento"
        disabled={busy}
        value={inbox.agent_bot_id ? String(inbox.agent_bot_id) : ''}
        onChange={(e) => void connect(e.target.value)}
      >
        <option value="">Nenhum</option>
        {(data || []).map((bot) => (
          <option key={bot.id} value={bot.id}>
            {bot.name}
          </option>
        ))}
      </select>
      {error && <span className="mt-1 block text-sm text-n-ruby-11">{error}</span>}
    </label>
  );
}
