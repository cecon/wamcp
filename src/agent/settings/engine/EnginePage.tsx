import { useEffect, useState } from 'react';
import { KeyRound, Send } from 'lucide-react';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { Cell, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { ActivityPanel } from './ActivityPanel';
import { AskModal } from './AskModal';
import { PermissionsPanel } from './PermissionsPanel';
import { StatusPill } from './StatusPill';
import { isFinal, type EngineActivity } from './types';

/** The agentic engine: requests given to AI agents, how they delegated, what they used and what it cost. */
export function EnginePage() {
  const activities = useFetch<EngineActivity[]>('/engine/activities');
  const roster = useFetch<RosterAgent[]>('/agent_directory');
  const [open, setOpen] = useState<number | null>(null),
    [asking, setAsking] = useState(false),
    [permissions, setPermissions] = useState(false);
  const list = (activities.data || []).filter((a) => a.parent_id === null);
  const ai = (roster.data || []).filter((a) => a.kind === 'ai' && a.active);
  const name = (id: number) => roster.data?.find((a) => a.id === id)?.name || `#${id}`;
  const busy = list.some((a) => !isFinal(a.status));
  const reload = activities.reload;

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(reload, 3000);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  return (
    <SettingsPage>
      <SettingsHeader
        title="Motor de agentes"
        description="Pedidos feitos aos agentes de IA: quem recebeu, para quem delegou, quais ferramentas usou, com que evidência respondeu e quanto consumiu. Tudo fica registrado e sobrevive a reinícios."
        count={`${list.length} pedido${list.length === 1 ? '' : 's'}`}
        action={
          <div className="flex gap-2">
            <Button
              icon={KeyRound}
              color="slate"
              variant="faded"
              label="Permissões"
              onClick={() => setPermissions(true)}
            />
            <Button
              icon={Send}
              label="Novo pedido"
              disabled={ai.length === 0}
              onClick={() => setAsking(true)}
            />
          </div>
        }
      />
      {(activities.error || roster.error) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {activities.error || roster.error}
        </p>
      )}
      <Table
        headers={['#', 'Agente', 'Pedido', 'Situação', 'Atualizado']}
        rows={list.length}
        empty={activities.data ? 'Nenhum pedido ainda.' : 'Carregando…'}
      >
        {list.map((activity) => (
          <tr
            key={activity.id}
            className="cursor-pointer hover:bg-n-alpha-1"
            onClick={() => setOpen(activity.id)}
          >
            <Cell className="w-12">{activity.id}</Cell>
            <Cell>
              <span className="font-medium text-n-slate-12">{name(activity.agent_id)}</span>
            </Cell>
            <Cell>
              <button
                type="button"
                className="text-start hover:underline"
                onClick={() => setOpen(activity.id)}
              >
                {activity.request}
              </button>
            </Cell>
            <Cell>
              <StatusPill status={activity.status} />
            </Cell>
            <Cell className="whitespace-nowrap">{new Date(activity.updated).toLocaleString('pt-BR')}</Cell>
          </tr>
        ))}
      </Table>
      {open !== null && (
        <ActivityPanel id={open} name={name} onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {asking && (
        <AskModal
          agents={ai}
          onClose={() => setAsking(false)}
          onStarted={(id) => {
            reload();
            setOpen(id);
          }}
        />
      )}
      {permissions && <PermissionsPanel agents={ai} onClose={() => setPermissions(false)} />}
    </SettingsPage>
  );
}
