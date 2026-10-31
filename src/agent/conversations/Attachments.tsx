import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Download, FileText, Mic, X } from 'lucide-react';

import { humanSize } from '../api';
import type { Attachment } from '../types';

const minutes = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Imagem do C3Theme (lote 19): miniatura com diálogo e link de download. */
function ImageBubble({ attachment: a }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const name = a.file_name || 'Imagem';
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label={`Abrir imagem ${name}`}
        onClick={() => setOpen(true)}
        sx={{
          display: 'block',
          overflow: 'hidden',
          borderRadius: 1,
          p: 0,
          border: 0,
          bgcolor: 'transparent',
          cursor: 'pointer',
        }}
      >
        <Box
          component="img"
          src={a.data_url}
          alt={name}
          loading="lazy"
          sx={{ maxHeight: 288, maxWidth: '100%', objectFit: 'cover' }}
        />
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" transitionDuration={0}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          {name}
          <IconButton aria-label="Fechar" size="small" onClick={() => setOpen(false)}>
            <X size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box
            component="img"
            src={a.data_url}
            alt={name}
            sx={{ mx: 'auto', maxHeight: '70vh', maxWidth: '100%', borderRadius: 1 }}
          />
          <Button
            component="a"
            href={a.data_url}
            download={a.file_name || true}
            startIcon={<Download size={16} />}
            sx={{ mt: 2 }}
          >
            Baixar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Chip de arquivo no C3Theme: ícone, nome, tamanho e download. */
function FileChip({ attachment: a }: { attachment: Attachment }) {
  const name = a.file_name || 'Arquivo';
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        height: 44,
        maxWidth: '100%',
        alignItems: 'center',
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        px: 1,
      }}
    >
      <FileText size={18} style={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap title={name} sx={{ maxWidth: 192 }}>
          {name}
        </Typography>
        {a.file_size != null && (
          <Typography variant="caption" color="text.secondary">
            {humanSize(a.file_size)}
          </Typography>
        )}
      </Box>
      <Box
        component="a"
        href={a.data_url}
        download={a.file_name || true}
        aria-label={`Baixar ${name}`}
        title="Baixar"
        sx={{
          display: 'grid',
          width: 32,
          height: 32,
          placeContent: 'center',
          color: 'text.secondary',
          flexShrink: 0,
        }}
      >
        <Download size={16} />
      </Box>
    </Stack>
  );
}

function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  if (a.file_type === 'image') return <ImageBubble attachment={a} />;
  if (a.file_type === 'sticker')
    return (
      <Box
        component="img"
        src={a.data_url}
        alt="Figurinha"
        loading="lazy"
        sx={{ width: 128, height: 128, objectFit: 'contain' }}
      />
    );
  if (a.file_type === 'audio')
    return (
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        {a.voice && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
            <Mic size={12} />
            <Typography variant="caption">
              Mensagem de voz{a.duration ? ` · ${minutes(a.duration)}` : ''}
            </Typography>
          </Stack>
        )}
        <Box
          component="audio"
          controls
          preload="metadata"
          src={a.data_url}
          aria-label={a.voice ? 'Mensagem de voz' : 'Áudio'}
        >
          <track kind="captions" />
        </Box>
      </Box>
    );
  if (a.file_type === 'video')
    return (
      <Box
        component="video"
        controls
        preload="metadata"
        src={a.data_url}
        aria-label="Vídeo"
        sx={{ maxHeight: 288, maxWidth: '100%', borderRadius: 1 }}
      >
        <track kind="captions" />
      </Box>
    );
  return <FileChip attachment={a} />;
}

/** Anexos da mensagem no C3Theme (lote 19): imagem/figurinha, áudio, vídeo e arquivos. */
export function Attachments({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <Box sx={{ mb: 1, display: 'grid', gap: 1 }}>
      {items.map((a) => (
        <AttachmentView key={a.id} attachment={a} />
      ))}
    </Box>
  );
}
