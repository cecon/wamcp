import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Contact as ContactIcon, MessageCircle, MessageSquareText } from 'lucide-react';

import { timeAgo } from '../api';
import type { SearchResults as Results } from '../parityTypes';
import { STATUS_LABEL } from '../labels';
import { Avatar } from '../ui/Avatar';
import { Highlight } from './Highlight';

const rowSx = {
  display: 'flex',
  width: '100%',
  alignItems: 'flex-start',
  gap: 1.5,
  borderRadius: 1,
  px: 1,
  py: 1,
  textAlign: 'left',
  justifyContent: 'flex-start',
  '&:hover': { bgcolor: 'action.hover' },
} as const;

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography
        variant="subtitle2"
        component="h2"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, pb: 0.5, color: 'text.secondary' }}
      >
        {icon} {title}
      </Typography>
      <Box component="ul" sx={{ display: 'flex', flexDirection: 'column', listStyle: 'none', m: 0, p: 0 }}>
        {children}
      </Box>
    </Box>
  );
}

function Hit({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Box component="li">
      <ButtonBase onClick={onClick} sx={rowSx}>
        {children}
      </ButtonBase>
    </Box>
  );
}

const Line = ({ children }: { children: ReactNode }) => (
  <Typography component="span" variant="body2" noWrap sx={{ display: 'block', fontWeight: 500 }}>
    {children}
  </Typography>
);

const Meta = ({ children }: { children: ReactNode }) => (
  <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
    {children}
  </Typography>
);

interface Props {
  results: Results;
  term: string;
  onOpenConversation: (displayId: number) => void;
  onOpenContact: (id: number) => void;
}

/** Chatwoot search result lists: conversations, contacts and messages with the term highlighted. */
export function SearchResults({ results, term, onOpenConversation, onOpenContact }: Props) {
  const { conversations = [], contacts = [], messages = [] } = results;
  return (
    <Stack spacing={3}>
      {conversations.length > 0 && (
        <Section title="Conversas" icon={<MessageCircle size={14} />}>
          {conversations.map((c) => (
            <Hit key={c.id} onClick={() => onOpenConversation(c.display_id)}>
              <Avatar name={c.contact_name || c.contact_phone} size={32} />
              <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
                <Line>
                  <Highlight text={`#${c.display_id}`} term={term} /> ·{' '}
                  <Highlight text={c.contact_name || c.contact_phone || 'Contato'} term={term} />
                </Line>
                <Meta>
                  {c.inbox_name} · {STATUS_LABEL[c.status]} · {timeAgo(c.last_activity_at)}
                </Meta>
              </Box>
            </Hit>
          ))}
        </Section>
      )}
      {contacts.length > 0 && (
        <Section title="Contatos" icon={<ContactIcon size={14} />}>
          {contacts.map((c) => (
            <Hit key={c.id} onClick={() => onOpenContact(c.id)}>
              <Avatar name={c.name || c.phone_number} size={32} />
              <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
                <Line>
                  <Highlight text={c.name || 'Sem nome'} term={term} />
                </Line>
                <Meta>
                  <Highlight text={[c.phone_number, c.email].filter(Boolean).join(' · ')} term={term} />
                </Meta>
              </Box>
            </Hit>
          ))}
        </Section>
      )}
      {messages.length > 0 && (
        <Section title="Mensagens" icon={<MessageSquareText size={14} />}>
          {messages.map((m) => (
            <Hit key={m.id} onClick={() => onOpenConversation(m.display_id)}>
              <Avatar name={m.contact_name} size={32} />
              <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
                <Line>
                  {m.contact_name || 'Contato'} · #{m.display_id}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ ml: 1, fontWeight: 400, color: 'text.secondary' }}
                  >
                    {timeAgo(m.created_at)}
                  </Typography>
                </Line>
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {m.message_type === 'outgoing' && 'Equipe: '}
                  <Highlight text={m.content} term={term} />
                </Typography>
              </Box>
            </Hit>
          ))}
        </Section>
      )}
    </Stack>
  );
}
