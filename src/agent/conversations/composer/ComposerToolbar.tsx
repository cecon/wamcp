import { useRef } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

// third-party
import { Mic, Paperclip } from 'lucide-react';

import { EmojiPicker } from './ComposerPickers';

interface Props {
  note: boolean;
  blocked: boolean;
  recording: boolean;
  busy: boolean;
  error: string;
  canSend: boolean;
  onInsertEmoji: (snippet: string) => void;
  onAddFiles: (files: FileList | null) => void;
  onRecord: () => void;
  onSend: () => void;
}

/** Barra inferior do composer no C3Theme (lote 21): emoji, anexos, áudio, erro e envio. */
export function ComposerToolbar({
  note,
  blocked,
  recording,
  busy,
  error,
  canSend,
  onInsertEmoji,
  onAddFiles,
  onRecord,
  onSend,
}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 1.5 }}>
      <Box sx={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 0.5 }}>
        <EmojiPicker onPick={onInsertEmoji} disabled={blocked || recording} />
        <IconButton
          size="small"
          aria-label="Anexar arquivos"
          title="Anexar arquivos"
          disabled={blocked || recording}
          onClick={() => picker.current?.click()}
        >
          <Paperclip size={16} />
        </IconButton>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="file-input"
          onChange={(event) => {
            onAddFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {!note && (
          <IconButton
            size="small"
            aria-label="Gravar áudio"
            title="Gravar áudio"
            disabled={blocked || recording || busy}
            onClick={onRecord}
          >
            <Mic size={16} />
          </IconButton>
        )}
        <Typography
          variant="caption"
          sx={{ ml: 1, color: 'error.main', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {error}
        </Typography>
      </Box>
      <Button
        variant="contained"
        color={note ? 'warning' : 'primary'}
        disabled={!canSend || recording}
        onClick={onSend}
      >
        {note ? 'Adicionar nota (↵)' : 'Enviar (↵)'}
      </Button>
    </Box>
  );
}
