import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Plus, X } from 'lucide-react';

import { http } from '../api';
import type { Contact, Label } from '../types';

interface Props {
  contact: Contact;
  labels: Label[];
  onSaved: (contact: Contact) => void;
  onError: (message: string) => void;
}

/** Etiquetas do contato no C3Theme (lote 11): chips com remover e menu de adicionar. */
export function ContactLabels({ contact, labels, onSaved, onError }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = contact.labels || [];
  const available = labels.filter((label) => !current.includes(label.title));
  const save = (next: string[]) =>
    void http<Contact>(`/contacts/${contact.id}/labels`, 'POST', { labels: next })
      .then(onSaved)
      .catch((e: Error) => onError(e.message));
  const color = (title: string) => labels.find((label) => label.title === title)?.color || '#8B8D98';
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {current.map((title) => (
        <Box
          key={title}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            height: 24,
            pl: 1,
            pr: 0.25,
            borderRadius: 1,
            bgcolor: 'action.hover',
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: 0.25, bgcolor: color(title) }} />
          <Typography variant="caption">{title}</Typography>
          <IconButton
            size="small"
            aria-label={`Remover etiqueta ${title}`}
            onClick={() => save(current.filter((label) => label !== title))}
            sx={{ p: 0.25 }}
          >
            <X size={12} />
          </IconButton>
        </Box>
      ))}
      <Button
        size="small"
        variant="outlined"
        startIcon={<Plus size={14} />}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        Adicionar etiqueta
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {available.length === 0 ? (
          <MenuItem disabled>Nenhuma etiqueta disponível.</MenuItem>
        ) : (
          available.map((label) => (
            <MenuItem
              key={label.id}
              onClick={() => {
                setAnchor(null);
                save([...current, label.title]);
              }}
            >
              {label.title}
            </MenuItem>
          ))
        )}
      </Menu>
    </Stack>
  );
}
