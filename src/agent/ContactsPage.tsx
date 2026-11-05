import { useCallback, useEffect, useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http, isForbidden, query, timeAgo, type Realtime } from './api';
import type { Catalog, Contact, User } from './types';
import { Avatar } from './ui/Avatar';
import { NoAccess } from './ui/NoAccess';
import { ContactDetail } from './contacts/ContactDetail';
import { ContactsToolbar, type ContactScope } from './contacts/ContactsToolbar';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './settings/c3/SettingsC3';

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

/** Contatos no C3Theme (lote 9): lista/cabeçalho no pacote; detalhe e modais seguem os do app. */
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

  const columns: ColumnDef<Contact>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorFn: (contact) => contact.name || 'Sem nome',
      cell: (info) => (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Avatar
            name={info.row.original.name || info.row.original.phone_number}
            src={info.row.original.avatar_url}
            size={32}
          />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {info.row.original.name || 'Sem nome'}
          </Typography>
          {info.row.original.blocked ? (
            <Typography variant="caption" sx={{ color: 'error.main' }}>
              Bloqueado
            </Typography>
          ) : null}
        </Stack>
      ),
    },
    {
      id: 'email',
      header: 'E-mail',
      accessorFn: (contact) => contact.email || '—',
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'phone',
      header: 'Telefone',
      accessorFn: (contact) => contact.phone_number || '—',
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    },
    {
      id: 'last_activity',
      header: 'Última atividade',
      accessorFn: (contact) => (contact.last_activity_at ? timeAgo(contact.last_activity_at) : '—'),
      cell: (info) => (
        <Typography variant="caption" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
  ];

  if (forbidden) return <NoAccess />;
  return (
    <SettingsC3Page>
      <SettingsC3Header
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
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={items}
          columns={columns}
          getRowId={(contact) => String(contact.id)}
          paginate={items.length > 25}
          empty="Nenhum contato encontrado."
          ariaLabel="Contatos"
          onRowClick={(row) => open(row.original.id)}
        />
      </Panel>
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
    </SettingsC3Page>
  );
}
