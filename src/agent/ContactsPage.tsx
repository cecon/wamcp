import { useCallback, useEffect, useState } from 'react';
import { http, isForbidden, query, timeAgo, type Realtime } from './api';
import type { Catalog, Contact, User } from './types';
import { Avatar } from './ui/Avatar';
import { NoAccess } from './ui/NoAccess';
import { Cell, SettingsHeader, SettingsPage, Table } from './ui/Settings';
import { ContactDetail } from './contacts/ContactDetail';
import { ContactsToolbar, type ContactScope } from './contacts/ContactsToolbar';

const EMPTY: Catalog = { inboxes: [], agents: [], teams: [], labels: [] };

interface Props {
  onOpenConversation: (displayId: number) => void;
  user?: User;
  catalog?: Catalog;
  /** Live updates: deleted contacts leave the list (and close their detail), edits are merged. */
  realtime?: Realtime;
  /** Contact opened in the side panel on arrival (from the global search). */
  contactId?: number;
}

/** Chatwoot Contacts: searchable/filterable list; a contact opens in a side panel with its details. */
export function ContactsPage({ onOpenConversation, user, catalog = EMPTY, realtime, contactId }: Props) {
  const [q, setQ] = useState(''),
    [scope, setScope] = useState<ContactScope>({ filters: null, viewId: null }),
    [items, setItems] = useState<Contact[]>([]),
    [selected, setSelected] = useState<Contact | null>(null),
    [error, setError] = useState(''),
    [forbidden, setForbidden] = useState(false);
  const isAdmin = user?.role === 'administrator';

  const load = useCallback(
    () =>
      (scope.filters
        ? http<Contact[]>('/contacts/filter', 'POST', { payload: scope.filters })
        : http<Contact[]>(`/contacts${query({ q })}`)
      )
        .then((list) => {
          setItems(list);
          setError('');
        })
        .catch((e: Error) => (isForbidden(e) ? setForbidden(true) : setError(e.message))),
    [q, scope],
  );
  useEffect(() => {
    const handle = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(handle);
  }, [load, q]);
  const open = (id: number) =>
    void http<Contact>(`/contacts/${id}`)
      .then(setSelected)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    if (!contactId) return;
    void http<Contact>(`/contacts/${contactId}`)
      .then(setSelected)
      .catch((e: Error) => setError(e.message));
  }, [contactId]);
  const replace = (c: Contact) => setItems((list) => list.map((x) => (x.id === c.id ? { ...x, ...c } : x)));
  const remove = (id: number) => {
    setSelected((current) => (current?.id === id ? null : current));
    setItems((list) => list.filter((x) => x.id !== id));
  };
  useEffect(
    () =>
      realtime?.subscribe(({ event, data }) => {
        if (event === 'contact.deleted') remove(Number(data.id));
        if (event === 'contact.updated') replace(data as unknown as Contact);
      }),
    [realtime],
  );

  if (forbidden) return <NoAccess />;
  return (
    <SettingsPage>
      <SettingsHeader
        title="Contatos"
        description="Pessoas que falaram com a sua equipe pelo WhatsApp."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar contatos…' }}
        count={`${items.length} contato${items.length === 1 ? '' : 's'}`}
        action={
          <ContactsToolbar
            scope={scope}
            catalog={catalog}
            isAdmin={isAdmin}
            onScope={setScope}
            onCreated={(c) => {
              setItems((list) => [c, ...list]);
              open(c.id);
            }}
            onReload={() => void load()}
            onError={setError}
          />
        }
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <Table
        headers={['Nome', 'E-mail', 'Telefone', 'Última atividade']}
        rows={items.length}
        empty="Nenhum contato encontrado."
      >
        {items.map((c) => (
          <tr key={c.id} onClick={() => open(c.id)} className="cursor-pointer hover:bg-n-alpha-1">
            <Cell>
              <span className="flex items-center gap-3">
                <Avatar name={c.name || c.phone_number} src={c.avatar_url} size={32} />
                <span className="font-medium text-n-slate-12">{c.name || 'Sem nome'}</span>
                {c.blocked ? <span className="text-xs text-n-ruby-11">Bloqueado</span> : null}
              </span>
            </Cell>
            <Cell>{c.email || '—'}</Cell>
            <Cell>{c.phone_number || '—'}</Cell>
            <Cell>{c.last_activity_at ? timeAgo(c.last_activity_at) : '—'}</Cell>
          </tr>
        ))}
      </Table>
      {selected && (
        <ContactDetail
          key={selected.id}
          contact={selected}
          catalog={catalog}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onSaved={replace}
          onMerged={(base) => {
            void load();
            open(base.id);
          }}
          onDeleted={remove}
          onOpenConversation={onOpenConversation}
        />
      )}
    </SettingsPage>
  );
}
