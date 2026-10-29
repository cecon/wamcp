import { useEffect, useState } from 'react';
import { http, query } from '../api';
import type { Contact, Inbox } from '../types';
import type { ChatAgent } from '../agentChat/types';
import { NewConversationModal } from '../contacts/NewConversationModal';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { Modal } from '../ui/Overlay';

interface Props {
  inboxes: Inbox[];
  onClose: () => void;
  /** Opens the private chat with an AI agent. */
  onAgent: (agentId: number) => void;
  /** Opens the WhatsApp conversation just started with a customer. */
  onConversation: (displayId: number) => void;
}

const matches = (text: string | null | undefined, q: string) =>
  (text || '').toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR'));

/** "Nova conversa" from the Conversas list: talk to one of your AI agents or write to a customer. */
export function NewChatModal({ inboxes, onClose, onAgent, onConversation }: Props) {
  const [q, setQ] = useState(''),
    [agents, setAgents] = useState<ChatAgent[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [contact, setContact] = useState<Contact | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    http<ChatAgent[]>('/agent_chats')
      .then(setAgents)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const handle = setTimeout(
      () =>
        void http<Contact[]>(`/contacts${query({ q: q.trim() })}`)
          .then(setContacts)
          .catch(() => setContacts([])),
      q ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [q]);

  if (contact)
    return (
      <NewConversationModal
        contact={contact}
        inboxes={inboxes}
        onClose={() => setContact(null)}
        onStarted={(c) => onConversation(c.display_id)}
      />
    );
  const shownAgents = agents.filter((a) => matches(a.name, q));
  const item = 'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-n-alpha-1';
  return (
    <Modal
      title="Nova conversa"
      description="Peça algo a um dos seus agentes de IA ou escreva para um cliente pelo WhatsApp."
      onClose={onClose}
    >
      <input
        className="field"
        type="search"
        aria-label="Buscar agente ou cliente"
        placeholder="Buscar por nome ou telefone"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <p className="mt-2 text-sm text-n-ruby-11">{error}</p>}
      <h3 className="mt-4 mb-1 text-xs font-medium text-n-slate-11 uppercase">Agentes</h3>
      {shownAgents.length === 0 && <p className="px-2 text-sm text-n-slate-11">Nenhum agente de IA ativo.</p>}
      <ul>
        {shownAgents.map((a) => (
          <li key={a.id}>
            <button type="button" className={item} onClick={() => onAgent(a.id)}>
              <MemberAvatar choices={a.avatar} kind="ai" seed={a.id} size={32} title={a.name} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-n-slate-12">{a.name}</span>
                <span className="block truncate text-xs text-n-slate-11">
                  {a.system ? 'Sistema · configura o app' : a.profile_name || 'Agente de IA'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 mb-1 text-xs font-medium text-n-slate-11 uppercase">Clientes</h3>
      {contacts.length === 0 && (
        <p className="px-2 text-sm text-n-slate-11">
          Nenhum contato encontrado. Cadastre o cliente em Contatos.
        </p>
      )}
      <ul>
        {contacts.slice(0, 8).map((c) => (
          <li key={c.id}>
            <button type="button" className={item} onClick={() => setContact(c)}>
              <span className="min-w-0">
                <span className="block truncate text-sm text-n-slate-12">{c.name || c.phone_number}</span>
                {c.name && c.phone_number && (
                  <span className="block truncate text-xs text-n-slate-11">{c.phone_number}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
