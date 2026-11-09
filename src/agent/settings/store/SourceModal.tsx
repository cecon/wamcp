import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import { http } from '../../api';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';

interface Props {
  /** The address in use ("" = the app's default). */
  current: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Points the store at another catalog (a `catalog.json` published anywhere); blank goes back to
 * the WAMCP one. */
export function SourceModal({ current, onClose, onSaved }: Props) {
  const [url, setUrl] = useState(current);
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Endereço da loja"
      description="A loja é um catalog.json publicado em qualquer endereço HTTPS: o do WAMCP, o da sua empresa ou o de quem você confia. Deixe em branco para voltar à loja do WAMCP."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/store/source', 'PUT', { url: url.trim() || null });
            onSaved();
            onClose();
          });
        }}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Endereço do catalog.json"
            placeholder="https://…/catalog.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            size="small"
            fullWidth
          />
          <ModalFooter busy={busy} submit="Salvar" onCancel={onClose} error={error} />
        </Stack>
      </form>
    </Modal>
  );
}
