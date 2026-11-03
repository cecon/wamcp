// material-ui
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// third-party
import { Copy } from 'lucide-react';

interface Props {
  label: string;
  secret: string;
  copyLabel: string;
}

/** Segredo somente leitura (assinatura de webhook, token do bot) com botão de copiar. */
export function SecretField({ label, secret, copyLabel }: Props) {
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          size="small"
          label={label}
          value={secret}
          fullWidth
          slotProps={{ htmlInput: { readOnly: true, 'aria-label': label, sx: { fontFamily: 'monospace' } } }}
        />
        <IconButton aria-label={copyLabel} onClick={() => void navigator.clipboard?.writeText(secret)}>
          <Copy size={16} />
        </IconButton>
      </Stack>
    </Stack>
  );
}
