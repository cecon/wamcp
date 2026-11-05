import { useState, type FormEvent } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';

import { http } from '../../api';
import type { Route } from '../../route';
import { useAction } from '../useAction';
import { ConnectionDetailPage } from './ConnectionDetailPage';
import type { Connection } from './model';

interface Props {
  connectionId: string;
  onNavigate: (route: Route) => void;
  /** Reloads the catalog: a new connection also creates its inbox. */
  onChange: () => Promise<void>;
}

/** Configurações → Canais → a WhatsApp connection: QR Code pairing, status and MCP access. */
export function ConnectionsPage({ connectionId, onNavigate, onChange }: Props) {
  return (
    <ConnectionDetailPage
      key={connectionId}
      id={connectionId}
      onBack={() => onNavigate({ page: 'settings', section: 'inboxes' })}
      onChange={onChange}
    />
  );
}

/** A new WhatsApp connection (its inbox is created with the same name). */
export function NewConnectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (connection: Connection) => void;
}) {
  const [name, setName] = useState('');
  const { error, busy, run } = useAction();
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      slotProps={{
        paper: {
          component: 'form',
          onSubmit: (e: FormEvent) => {
            e.preventDefault();
            void run(async () =>
              onCreated(await http<Connection>('/sessions', 'POST', { name: name.trim() })),
            );
          },
        } as object,
      }}
    >
      <DialogTitle>Nova conexão</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Dê um nome para identificar este WhatsApp. Uma caixa de entrada com o mesmo nome é criada.
        </DialogContentText>
        <TextField
          label="Nome da conexão"
          size="small"
          fullWidth
          autoFocus
          placeholder="Ex.: Atendimento"
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !name.trim()} loading={busy}>
          Criar conexão
        </Button>
      </DialogActions>
    </Dialog>
  );
}
