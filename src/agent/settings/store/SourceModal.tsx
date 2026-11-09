import { useState } from 'react';

// material-ui
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../../api';
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
    <ActionDialog
      open
      title="Endereço da loja"
      description="A loja é um catalog.json publicado em qualquer endereço HTTPS: o do WAMCP, o da sua empresa ou o de quem você confia. Deixe em branco para voltar à loja do WAMCP."
      confirmLabel="Salvar"
      backLabel="Cancelar"
      dirty={url !== current}
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          await http('/store/source', 'PUT', { url: url.trim() || null });
          onSaved();
          onClose();
        })
      }
    >
      <TextField
        label="Endereço do catalog.json"
        placeholder="https://…/catalog.json"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        size="small"
        fullWidth
        autoFocus
      />
    </ActionDialog>
  );
}
