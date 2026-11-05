import { useEffect, useMemo } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { FileText, Reply, Send, Trash2, X } from 'lucide-react';

import { humanSize } from '../../api';
import type { Message } from '../../types';
import { authorOf, snippet } from '../messageText';

/** Faixa “Respondendo a” no C3Theme (lote 25). */
export function ReplyToBar({ message, onCancel }: { message: Message; onCancel: () => void }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        mx: 1.5,
        mt: 1.5,
        alignItems: 'center',
        borderRadius: 1,
        bgcolor: 'action.hover',
        px: 1.5,
        py: 1,
      }}
    >
      <Box sx={{ flexShrink: 0, color: 'text.secondary', display: 'flex' }}>
        <Reply size={14} />
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
        Respondendo a{' '}
        <Box component="span" sx={{ fontWeight: 500, color: 'text.primary' }}>
          {authorOf(message)}
        </Box>
        : {snippet(message)}
      </Typography>
      <IconButton size="small" aria-label="Cancelar resposta" onClick={onCancel}>
        <X size={14} />
      </IconButton>
    </Stack>
  );
}

function PendingFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const image = file.type.startsWith('image/');
  const url = useMemo(() => (image ? URL.createObjectURL(file) : ''), [file, image]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <Box
      component="li"
      sx={{
        position: 'relative',
        display: 'flex',
        height: 56,
        maxWidth: 224,
        alignItems: 'center',
        gap: 1,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        pr: 3.5,
        pl: 0.5,
      }}
    >
      {image ? (
        <Box
          component="img"
          src={url}
          alt={file.name}
          sx={{ width: 48, height: 48, borderRadius: 1, objectFit: 'cover' }}
        />
      ) : (
        <Box sx={{ ml: 1, flexShrink: 0, color: 'text.secondary', display: 'flex' }}>
          <FileText size={20} />
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: 'block' }} noWrap>
          {file.name}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: 10 }}>
          {humanSize(file.size)}
        </Typography>
      </Box>
      <IconButton
        size="small"
        aria-label={`Remover ${file.name}`}
        onClick={onRemove}
        sx={{ position: 'absolute', top: 2, right: 2 }}
      >
        <X size={12} />
      </IconButton>
    </Box>
  );
}

/** Prévia dos anexos no C3Theme (lote 25). */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return (
    <Box
      component="ul"
      aria-label="Anexos"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', m: 0, px: 1.5, pt: 1.5 }}
    >
      {files.map((file, i) => (
        <PendingFile key={`${file.name}-${i}`} file={file} onRemove={() => onRemove(i)} />
      ))}
    </Box>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Gravação de áudio no C3Theme (lote 25): tempo, descartar e enviar. */
export function RecorderBar({
  elapsed,
  busy,
  onCancel,
  onSend,
}: {
  elapsed: number;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <Stack
      direction="row"
      role="group"
      aria-label="Gravando áudio"
      spacing={1.5}
      sx={{ height: 72, alignItems: 'center', px: 1.5 }}
    >
      <Box
        aria-hidden
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: 'error.main',
          animation: 'pulse 1.5s infinite',
        }}
      />
      <Typography variant="body2" aria-label="Tempo de gravação" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {clock(elapsed)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        Gravando áudio…
      </Typography>
      <IconButton aria-label="Descartar áudio" color="error" onClick={onCancel}>
        <Trash2 size={16} />
      </IconButton>
      <Button variant="contained" startIcon={<Send size={14} />} disabled={busy} onClick={onSend}>
        Enviar áudio
      </Button>
    </Stack>
  );
}
