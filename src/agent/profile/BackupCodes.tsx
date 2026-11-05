import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

// third-party
import { Copy, Download } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { copyText, saveTextFile } from './browser';

/** The 10 one-time backup codes, shown once right after enabling two-factor authentication. */
export function BackupCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <ActionDialog
      open
      title="Salve seus códigos de recuperação"
      description="Cada código pode ser usado uma única vez caso você perca o acesso ao aplicativo autenticador. Você não poderá vê-los novamente."
      confirmLabel="Concluir"
      backLabel="Fechar"
      onClose={onClose}
      onConfirm={onClose}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box
          component="ul"
          aria-label="Códigos de recuperação"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
            m: 0,
            p: 2,
            listStyle: 'none',
            borderRadius: 1.5,
            bgcolor: 'var(--color-n-alpha-1)',
          }}
        >
          {codes.map((code) => (
            <Box
              component="li"
              key={code}
              sx={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 14 }}
            >
              {code}
            </Box>
          ))}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Copy size={14} />}
            onClick={() => void copyText(text).then(setCopied)}
          >
            {copied ? 'Copiados' : 'Copiar todos'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Download size={14} />}
            onClick={() => saveTextFile('wamcp-codigos-de-recuperacao.txt', `${text}\n`)}
          >
            Baixar
          </Button>
        </Stack>
      </Stack>
    </ActionDialog>
  );
}
