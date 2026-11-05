import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { upload } from '../api';
import type { ImportResult } from '../types';
import { useAction } from '../settings/useAction';

/** "Importar contatos" no C3Theme (lote 12): CSV com name, phone_number, email, identifier; atualiza por telefone. */
export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<ImportResult | null>(null);
  const { error, busy, run } = useAction();
  const submit = () =>
    void run(async () => {
      if (!file) return;
      const form = new FormData();
      form.append('import_file', file);
      setResult(await upload<ImportResult>('/contacts/import', form));
      onImported();
    });
  return (
    <ActionDialog
      open
      title="Importar contatos"
      description="Envie um CSV com o cabeçalho name, phone_number, email, identifier. Contatos com o mesmo telefone são atualizados."
      confirmLabel="Importar"
      backLabel="Cancelar"
      loading={busy || !file}
      error={error}
      onClose={onClose}
      onConfirm={submit}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box
          component="input"
          type="file"
          accept=".csv,text/csv"
          aria-label="Arquivo CSV"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)}
          sx={{ fontSize: 14 }}
        />
        {result && (
          <Stack spacing={1} role="status">
            <Typography variant="body2">
              {result.created} criado(s), {result.updated} atualizado(s), {result.failed.length} com erro.
            </Typography>
            {result.failed.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'error.main' }}>
                {result.failed.map((failure) => (
                  <Box component="li" key={failure.line}>
                    <Typography variant="body2" color="inherit">
                      Linha {failure.line}: {failure.error}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </ActionDialog>
  );
}
