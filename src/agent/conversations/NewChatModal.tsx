import { lazy, Suspense, useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Typography from '@mui/material/Typography';

// third-party
import { Search, X } from 'lucide-react';

import { http, query } from '../api';
import type { Contact, Inbox } from '../types';
import type { ChatAgent } from '../agentChat/types';
import C3Provider from '../c3/C3Provider';
// O modal de nova conversa usa o C3Theme (MUI): carrega em chunk próprio para o painel seguir leve.
const NewConversationModal = lazy(() =>
  import('../contacts/NewConversationModal').then((module) => ({ default: module.NewConversationModal })),
);
import { MemberAvatar } from '../settings/members/MemberAvatar';

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

const rowSx = {
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: 1.5,
  borderRadius: 1,
  px: 1,
  py: 1,
  textAlign: 'left',
  justifyContent: 'flex-start',
  '&:hover': { bgcolor: 'action.hover' },
} as const;

const GroupTitle = ({ children }: { children: string }) => (
  <Typography
    variant="caption"
    component="h3"
    sx={{
      display: 'block',
      mt: 2,
      mb: 0.5,
      fontWeight: 500,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'text.secondary',
    }}
  >
    {children}
  </Typography>
);

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
      <Suspense fallback={null}>
        <NewConversationModal
          contact={contact}
          inboxes={inboxes}
          onClose={() => setContact(null)}
          onStarted={(c) => onConversation(c.display_id)}
        />
      </Suspense>
    );
  const shownAgents = agents.filter((a) => matches(a.name, q));
  return (
    <C3Provider>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 7 }}>
          Nova conversa
          <IconButton
            size="small"
            aria-label="Fechar"
            onClick={onClose}
            sx={{ position: 'absolute', top: 10, right: 10 }}
          >
            <X size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Peça algo a um dos seus agentes de IA ou escreva para um cliente pelo WhatsApp.
          </Typography>
          <OutlinedInput
            fullWidth
            size="small"
            autoFocus
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            startAdornment={
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            }
            slotProps={{ input: { 'aria-label': 'Buscar agente ou cliente' } }}
          />
          {error && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {error}
            </Typography>
          )}
          <GroupTitle>Agentes</GroupTitle>
          {shownAgents.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
              Nenhum agente de IA ativo.
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {shownAgents.map((a) => (
              <Box component="li" key={a.id}>
                <ButtonBase sx={rowSx} onClick={() => onAgent(a.id)}>
                  <MemberAvatar choices={a.avatar} kind="ai" seed={a.id} size={32} title={a.name} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ display: 'block' }}>
                      {a.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {a.system ? 'Sistema · configura o app' : a.profile_name || 'Agente de IA'}
                    </Typography>
                  </Box>
                </ButtonBase>
              </Box>
            ))}
          </Box>
          <GroupTitle>Clientes</GroupTitle>
          {contacts.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
              Nenhum contato encontrado. Cadastre o cliente em Contatos.
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {contacts.slice(0, 8).map((c) => (
              <Box component="li" key={c.id}>
                <ButtonBase sx={rowSx} onClick={() => setContact(c)}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ display: 'block' }}>
                      {c.name || c.phone_number}
                    </Typography>
                    {c.name && c.phone_number && (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {c.phone_number}
                      </Typography>
                    )}
                  </Box>
                </ButtonBase>
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </C3Provider>
  );
}
