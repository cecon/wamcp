import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { Trash2 } from 'lucide-react';

import { http } from '../api';
import type { ContactNote } from '../types';

interface Props {
  contactId: number;
  onError: (message: string) => void;
}

/** Notas do contato no C3Theme (lote 10): adiciona, lista da mais nova e exclui (autor ou administrador). */
export function ContactNotes({ contactId, onError }: Props) {
  const [notes, setNotes] = useState<ContactNote[]>([]),
    [draft, setDraft] = useState('');
  const path = `/contacts/${contactId}/notes`;
  useEffect(() => {
    void http<ContactNote[]>(path)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [path]);
  const fail = (e: Error) => onError(e.message);
  return (
    <Stack spacing={1.5}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void http<ContactNote>(path, 'POST', { content: draft.trim() })
            .then((note) => {
              setNotes((list) => [note, ...list]);
              setDraft('');
            })
            .catch(fail);
        }}
      >
        <Stack spacing={1}>
          <TextField
            multiline
            minRows={2}
            value={draft}
            placeholder="Escreva uma nota sobre o contato…"
            onChange={(event) => setDraft(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 5000, 'aria-label': 'Nova nota' } }}
          />
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={!draft.trim()}
            sx={{ alignSelf: 'flex-end' }}
          >
            Adicionar nota
          </Button>
        </Stack>
      </Box>
      {notes.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nenhuma nota ainda.
        </Typography>
      )}
      <Box
        component="ul"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, listStyle: 'none', m: 0, p: 0 }}
      >
        {notes.map((note) => (
          <Box key={note.id} component="li" sx={{ borderRadius: 1.5, bgcolor: 'action.hover', p: 1.5 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {note.content}
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {note.user_name || 'Sistema'} · {new Date(note.created_at * 1000).toLocaleString('pt-BR')}
              </Typography>
              <IconButton
                size="small"
                aria-label="Excluir nota"
                onClick={() =>
                  void http(`${path}/${note.id}`, 'DELETE')
                    .then(() => setNotes((list) => list.filter((x) => x.id !== note.id)))
                    .catch(fail)
                }
              >
                <Trash2 size={14} />
              </IconButton>
            </Stack>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
