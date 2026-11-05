import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { AtSign, Search, Smile } from 'lucide-react';

import type { Canned, User } from '../../types';
import { Avatar } from '../../ui/Avatar';

// prettier-ignore
const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😉', '😎', '🤔', '😐', '😅',
  '😢', '😭', '😡', '😮', '😴', '🤗', '🙄', '😬', '👍', '👎', '👏', '🙏',
  '🙌', '👋', '💪', '🤝', '👀', '✅', '❌', '⚠️', '❤️', '💙', '🎉', '🔥',
  '⭐', '💡', '📌', '📞', '📦', '💰', '🕒', '🚀',
];

/** Grid compacto de emoji no C3Theme (lote 25); o composer insere no caret. */
export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ position: 'relative', display: 'flex' }}>
      <IconButton
        size="small"
        aria-label="Inserir emoji"
        title="Emoji"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Smile size={16} />
      </IconButton>
      {open && (
        <Box
          role="menu"
          aria-label="Emoji"
          sx={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            zIndex: 20,
            mb: 1,
            width: 288,
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            gap: 0.5,
            p: 1,
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            boxShadow: 3,
          }}
        >
          {EMOJIS.map((emoji) => (
            <Button
              key={emoji}
              role="menuitem"
              aria-label={emoji}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              sx={{ minWidth: 0, width: 32, height: 32, p: 0, fontSize: 18 }}
            >
              {emoji}
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface CannedProps {
  shortcut: string;
  options: Canned[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (canned: Canned) => void;
}

/** Respostas prontas no C3Theme (lote 25): lista à esquerda, prévia da destacada à direita. */
export function CannedList({ shortcut, options, highlight, onHighlight, onPick }: CannedProps) {
  const preview = options[highlight];
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        zIndex: 20,
        mb: 1,
        display: 'flex',
        height: 240,
        width: '100%',
        maxWidth: 768,
        overflow: 'hidden',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 4,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          width: '100%',
          maxWidth: 420,
          flexDirection: 'column',
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            height: 44,
            flexShrink: 0,
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            px: 1.5,
            color: 'text.secondary',
          }}
        >
          <Search size={14} />
          <Typography variant="body2">Respostas prontas: /{shortcut}</Typography>
        </Stack>
        <Box
          component="ul"
          role="listbox"
          aria-label="Respostas prontas"
          sx={{ overflowY: 'auto', p: 0.5, m: 0, listStyle: 'none' }}
        >
          {options.map((c, i) => (
            <Box component="li" key={c.id} role="option" aria-selected={i === highlight}>
              <Button
                fullWidth
                onMouseEnter={() => onHighlight(i)}
                onClick={() => onPick(c)}
                sx={{
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  textTransform: 'none',
                  px: 1,
                  py: 0.5,
                  bgcolor: i === highlight ? 'action.selected' : 'transparent',
                }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, display: 'block' }}>
                    /{c.short_code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {c.content}
                  </Typography>
                </Box>
              </Button>
            </Box>
          ))}
        </Box>
      </Box>
      {preview && (
        <Typography
          variant="body2"
          sx={{
            display: { xs: 'none', md: 'block' },
            flex: 1,
            overflowY: 'auto',
            px: 2,
            py: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {preview.content}
        </Typography>
      )}
    </Box>
  );
}

interface MentionProps {
  query: string;
  options: User[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (agent: User) => void;
}

/** Menção de agentes no C3Theme (lote 25): agentes que casam com “@query” na nota privada. */
export function MentionList({ query, options, highlight, onHighlight, onPick }: MentionProps) {
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        zIndex: 20,
        mb: 1,
        width: '100%',
        maxWidth: 320,
        overflow: 'hidden',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 4,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          height: 36,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          px: 1.5,
          color: 'text.secondary',
        }}
      >
        <AtSign size={14} />
        <Typography variant="caption">Mencionar agente{query ? `: ${query}` : ''}</Typography>
      </Stack>
      <Box
        component="ul"
        role="listbox"
        aria-label="Mencionar agente"
        sx={{ maxHeight: 240, overflowY: 'auto', p: 0.5, m: 0, listStyle: 'none' }}
      >
        {options.map((a, i) => (
          <Box component="li" key={a.id} role="option" aria-selected={i === highlight}>
            <Button
              fullWidth
              onMouseEnter={() => onHighlight(i)}
              onClick={() => onPick(a)}
              sx={{
                justifyContent: 'flex-start',
                gap: 1,
                px: 1,
                py: 0.75,
                textTransform: 'none',
                bgcolor: i === highlight ? 'action.selected' : 'transparent',
              }}
            >
              <Avatar name={a.name} size={24} />
              <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                <Typography variant="body2" sx={{ fontWeight: 500, display: 'block' }} noWrap>
                  {a.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                  {a.email}
                </Typography>
              </Box>
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
