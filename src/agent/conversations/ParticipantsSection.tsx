import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { UserPlus, X } from 'lucide-react';

import { http } from '../api';
import type { Catalog, Conversation, User } from '../types';
import { Avatar } from '../ui/Avatar';

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onError: (message: string) => void;
}

/** Participantes da conversa no C3Theme (lote 23): agentes que acompanham, com entrar/sair e adicionar. */
export function ParticipantsSection({ conversation: c, user, catalog, onError }: Props) {
  const [participants, setParticipants] = useState<User[]>([]),
    [adding, setAdding] = useState(false);
  const path = `/conversations/${c.display_id}/participants`;
  useEffect(() => {
    void http<User[]>(path)
      .then(setParticipants)
      .catch(() => setParticipants([]));
  }, [path]);
  const ids = participants.map((p) => p.id);
  const save = (userIds: number[]) =>
    void http<User[]>(path, 'PATCH', { user_ids: userIds })
      .then(setParticipants)
      .catch((e: Error) => onError(e.message));
  const joined = ids.includes(user.id);
  const available = catalog.agents.filter(
    (a) =>
      a.active && !ids.includes(a.id) && (a.role === 'administrator' || a.inbox_ids?.includes(c.inbox_id)),
  );

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          {participants.length} participante{participants.length === 1 ? '' : 's'}
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={() => save(joined ? ids.filter((id) => id !== user.id) : [...ids, user.id])}
          sx={{ fontSize: 12, textTransform: 'none' }}
        >
          {joined ? 'Deixar de participar' : 'Participar'}
        </Button>
      </Stack>
      <Box
        component="ul"
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, listStyle: 'none', m: 0, p: 0 }}
      >
        {participants.map((p) => (
          <Stack component="li" key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Avatar name={p.name} size={24} />
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {p.name}
            </Typography>
            <IconButton
              size="small"
              aria-label={`Remover participante ${p.name}`}
              onClick={() => save(ids.filter((id) => id !== p.id))}
            >
              <X size={14} />
            </IconButton>
          </Stack>
        ))}
      </Box>
      <Button
        size="small"
        variant="outlined"
        startIcon={<UserPlus size={14} />}
        onClick={() => setAdding(true)}
        sx={{ alignSelf: 'flex-start' }}
      >
        Adicionar participante
      </Button>
      {adding && (
        <Box
          role="menu"
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 240, overflowY: 'auto' }}
        >
          {available.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              Nenhum agente disponível.
            </Typography>
          ) : (
            available.map((a) => (
              <Button
                key={a.id}
                role="menuitem"
                fullWidth
                onClick={() => {
                  setAdding(false);
                  save([...ids, a.id]);
                }}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                {a.name}
              </Button>
            ))
          )}
        </Box>
      )}
    </Stack>
  );
}
