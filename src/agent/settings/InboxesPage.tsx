import { useEffect, useState } from 'react';
import { MessageCircle, Settings } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Inbox, User } from '../types';
import type { Route } from '../route';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { SettingsHeader, SettingsPage, Toggle } from '../ui/Settings';
import { InboxAutomation } from './InboxAutomation';
import { useAction } from './useAction';

interface Props {
  catalog: Catalog;
  inboxId?: number;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

/** Chatwoot Inboxes: channel tile list; each inbox opens a settings page with tabs. */
export function InboxesPage({ catalog, inboxId, onNavigate, onChange }: Props) {
  const inbox = inboxId ? catalog.inboxes.find((i) => i.id === inboxId) : undefined;
  if (inbox)
    return <InboxDetail inbox={inbox} catalog={catalog} onNavigate={onNavigate} onChange={onChange} />;
  return (
    <SettingsPage>
      <SettingsHeader
        title="Caixas de entrada"
        description="Cada sessão do WhatsApp conectada no app desktop é um canal. Novas sessões aparecem aqui automaticamente."
        count={`${catalog.inboxes.length} caixa${catalog.inboxes.length === 1 ? '' : 's'}`}
      />
      <ul className="divide-y divide-n-weak border-t border-n-weak">
        {catalog.inboxes.length === 0 && (
          <li className="py-20 text-center text-base">Nenhuma caixa de entrada.</li>
        )}
        {catalog.inboxes.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-n-strong bg-n-alpha-3 text-n-slate-10 shadow-sm ring ring-n-solid-1">
                <MessageCircle size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-heading-3 truncate text-n-slate-12">{i.name}</p>
                <p className="truncate text-sm text-n-slate-11">
                  WhatsApp · {i.phone ? `+${i.phone}` : 'sem número'} ·{' '}
                  {i.session_status === 'connected' ? 'conectado' : i.session_status}
                </p>
              </div>
            </div>
            <Button
              color="slate"
              variant="faded"
              icon={Settings}
              aria-label={`Configurar ${i.name}`}
              onClick={() => onNavigate({ page: 'settings', section: 'inboxes', id: i.id })}
            />
          </li>
        ))}
      </ul>
    </SettingsPage>
  );
}

const TABS = [
  ['settings', 'Configurações'],
  ['collaborators', 'Colaboradores'],
  ['hours', 'Horário e mensagens'],
] as const;

function InboxDetail({ inbox, catalog, onNavigate, onChange }: { inbox: Inbox } & Omit<Props, 'inboxId'>) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('settings'),
    [name, setName] = useState(inbox.name),
    [members, setMembers] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/inboxes/${inbox.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [inbox.id]);
  const patch = (fields: Record<string, unknown>) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}`, 'PATCH', fields);
      await onChange();
    });
  const toggleMember = (id: number) =>
    run(async () => {
      const add = !members.includes(id);
      const list = await http<User[]>(`/inboxes/${inbox.id}/members`, add ? 'POST' : 'DELETE', {
        user_ids: [id],
      });
      setMembers(list.map((u) => u.id));
      await onChange();
    });

  return (
    <SettingsPage>
      <SettingsHeader
        title={inbox.name}
        description={`WhatsApp · ${inbox.phone ? `+${inbox.phone}` : 'sem número'}`}
        back={{
          label: 'Caixas de entrada',
          onClick: () => onNavigate({ page: 'settings', section: 'inboxes' }),
        }}
      />
      <nav role="tablist" className="flex gap-4 border-b border-n-weak">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'relative py-2.5 text-sm font-medium',
              tab === id ? 'text-n-blue-11' : 'text-n-slate-11 hover:text-n-slate-12',
            )}
          >
            {label}
            {tab === id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-n-brand" />}
          </button>
        ))}
      </nav>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      {tab === 'settings' && (
        <div className="flex max-w-2xl flex-col">
          <form
            className="flex items-end gap-2 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ name });
            }}
          >
            <label className="flex-1">
              <span className="field-label">Nome da caixa</span>
              <input
                className="field"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="md"
              color="slate"
              label="Renomear"
              disabled={busy || name === inbox.name}
            />
          </form>
          <div className="divide-y divide-n-weak">
            <Toggle
              label="Atribuição automática"
              hint="Distribui novas conversas em rodízio entre agentes online."
              checked={Boolean(inbox.enable_auto_assignment)}
              onChange={(v) => void patch({ enable_auto_assignment: v })}
            />
            <Toggle
              label="Uma conversa por contato"
              hint="Mensagem nova reabre a conversa resolvida em vez de criar outra."
              checked={Boolean(inbox.lock_to_single_conversation)}
              onChange={(v) => void patch({ lock_to_single_conversation: v })}
            />
            <Toggle
              label="Ignorar grupos"
              hint="Grupos do WhatsApp não viram conversas."
              checked={Boolean(inbox.ignore_groups)}
              onChange={(v) => void patch({ ignore_groups: v })}
            />
            <Toggle
              label="Atendimento por IA (MCP)"
              hint="Conversas novas ficam pendentes para a IA até ela transferir para humanos."
              checked={Boolean(inbox.agent_bot_enabled)}
              onChange={(v) => void patch({ agent_bot_enabled: v })}
            />
          </div>
        </div>
      )}
      {tab === 'collaborators' && (
        <ul className="divide-y divide-n-weak border-t border-n-weak">
          {catalog.agents
            .filter((a) => a.active)
            .map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                <span className="flex items-center gap-3">
                  <Avatar name={a.name} size={32} status={a.availability} />
                  <span className="text-sm text-n-slate-12">
                    {a.name}
                    {a.role === 'administrator' && <span className="text-n-slate-10"> · admin vê todas</span>}
                  </span>
                </span>
                <Toggle
                  compact
                  label={`Acesso ${a.name}`}
                  checked={members.includes(a.id)}
                  onChange={() => void toggleMember(a.id)}
                />
              </li>
            ))}
        </ul>
      )}
      {tab === 'hours' && (
        <div className="max-w-2xl">
          <InboxAutomation inbox={inbox} onChange={onChange} />
        </div>
      )}
    </SettingsPage>
  );
}
