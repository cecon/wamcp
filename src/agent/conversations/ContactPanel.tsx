import { useEffect, useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { AtSign, Mail, Phone, X } from 'lucide-react';

import { http, timeAgo } from '../api';
import type { Catalog, Contact, Conversation, FilterValue, User } from '../types';
import { STATUS_LABEL } from '../labels';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { AttributesSection } from '../attributes/AttributesSection';
import { Accordion } from '../ui/Accordion';
import { ConversationActions } from './ConversationActions';
import { ParticipantsSection } from './ParticipantsSection';
import { MacroRunner } from '../macros/MacroRunner';
import { SlaSection } from '../sla/SlaSection';

const Row = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <Stack direction="row" spacing={1} sx={{ minWidth: 0, alignItems: 'center' }}>
    <Box sx={{ flexShrink: 0, color: 'text.disabled', display: 'flex' }}>{icon}</Box>
    <Typography variant="body2" color="text.secondary" noWrap>
      {children}
    </Typography>
  </Stack>
);

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
  onOpenConversation: (displayId: number) => void;
  onClose: () => void;
}

/** Painel do contato no C3Theme (lote 22): contato e seções reordenáveis (ações, SLA, macros, participantes…). */
export function ContactPanel({
  conversation: c,
  user,
  catalog,
  onChange,
  onError,
  onOpenConversation,
  onClose,
}: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  useEffect(() => {
    void http<Contact>(`/contacts/${c.contact_id}`)
      .then(setContact)
      .catch(() => setContact(null));
  }, [c.contact_id, c.id]);
  const name = c.contact_name || c.contact_phone || 'Contato';
  const saveConversationAttribute = async (key: string, value: FilterValue | null) =>
    onChange(
      await http<Conversation>(`/conversations/${c.display_id}/custom_attributes`, 'POST', {
        custom_attributes: { [key]: value },
      }),
    );
  const saveContactAttribute = async (key: string, value: FilterValue | null) =>
    setContact({
      ...contact,
      ...(await http<Contact>(`/contacts/${c.contact_id}`, 'PATCH', { custom_attributes: { [key]: value } })),
    });
  const previous = (contact?.conversations || []).filter((p) => p.id !== c.id);

  return (
    <Box
      component="aside"
      aria-label="Painel do contato"
      sx={{
        display: { xs: 'none', xl: 'flex' },
        height: '100%',
        width: { xl: 320, '2xl': 360 },
        flexShrink: 0,
        flexDirection: 'column',
        overflowY: 'auto',
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'var(--color-n-surface-2)',
      }}
    >
      <Stack
        direction="row"
        sx={{
          height: 48,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          py: 1,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Contato
        </Typography>
        <IconButton size="small" aria-label="Fechar painel" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>
      <Stack spacing={1} sx={{ p: 2 }}>
        <Avatar name={name} src={contact?.avatar_url ?? c.contact_avatar_url} size={48} />
        <Typography variant="subtitle1" sx={{ mt: 0.5, fontWeight: 500 }}>
          {name}
        </Typography>
        {contact?.email && <Row icon={<Mail size={14} />}>{contact.email}</Row>}
        {c.contact_phone && <Row icon={<Phone size={14} />}>{c.contact_phone}</Row>}
        <Row icon={<AtSign size={14} />}>{c.contact_jid}</Row>
      </Stack>
      <Stack spacing={1.5} sx={{ px: 1, pb: 4 }}>
        <Accordion title="Ações da conversa" open>
          <ConversationActions
            conversation={c}
            user={user}
            catalog={catalog}
            onChange={onChange}
            onError={onError}
          />
        </Accordion>
        <Accordion title="SLA">
          {/* Remounts (and reloads the deadlines) when the conversation status or waiting time changes. */}
          <SlaSection key={`${c.display_id}:${c.status}:${c.waiting_since ?? ''}`} displayId={c.display_id} />
        </Accordion>
        <Accordion title="Macros">
          <MacroRunner conversation={c} onChange={onChange} />
        </Accordion>
        <Accordion title="Participantes da conversa">
          <ParticipantsSection conversation={c} user={user} catalog={catalog} onError={onError} />
        </Accordion>
        <Accordion title="Atributos da conversa">
          <AttributesSection
            model="conversation"
            values={c.custom_attributes}
            onSave={saveConversationAttribute}
          />
        </Accordion>
        <Accordion title="Atributos do contato">
          <AttributesSection
            model="contact"
            values={contact?.custom_attributes}
            onSave={saveContactAttribute}
          />
        </Accordion>
        <Accordion title="Informações da conversa">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1 }}>
            {[
              ['Número', `#${c.display_id}`],
              ['Caixa', c.inbox_name],
              ['Status', STATUS_LABEL[c.status]],
              ['Última atividade', timeAgo(c.last_activity_at)],
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="body2">{value}</Typography>
              </Box>
            ))}
          </Box>
        </Accordion>
        <Accordion title="Conversas anteriores">
          {previous.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhuma conversa anterior.
            </Typography>
          ) : (
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {previous.map((p) => (
                <Box component="li" key={p.id}>
                  <Button
                    color="slate"
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    label={
                      <>
                        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                          #{p.display_id}
                        </Typography>{' '}
                        <Typography component="span" variant="caption" color="text.secondary">
                          {p.inbox_name} · {STATUS_LABEL[p.status]} · {timeAgo(p.last_activity_at)}
                        </Typography>
                      </>
                    }
                    onClick={() => onOpenConversation(p.display_id)}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </Accordion>
      </Stack>
    </Box>
  );
}
