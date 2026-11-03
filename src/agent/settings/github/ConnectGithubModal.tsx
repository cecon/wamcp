import { useState, type FormEvent } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { Inbox } from '../../types';
import { useAction } from '../useAction';
import { WebhookInstructions, type GithubWebhook } from './WebhookInstructions';

interface Connection extends GithubWebhook {
  inbox: Inbox;
  hook_error: string | null;
}

interface Props {
  onClose: () => void;
  onConnected: () => Promise<void>;
}

/**
 * Connects a GitHub repository as an inbox: its events become conversations the inbox's agent answers.
 * Usa o `Dialog` do MUI direto (e não o `ActionDialog`): este modal também é montado fora do `C3Provider` nos testes.
 */
export function ConnectGithubModal({ onClose, onConnected }: Props) {
  const [name, setName] = useState(''),
    [repo, setRepo] = useState(''),
    [token, setToken] = useState(''),
    [done, setDone] = useState<Connection | null>(null);
  const { error, busy, run } = useAction();

  if (done)
    return (
      <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
        <DialogTitle>Repositório conectado</DialogTitle>
        <DialogContent>
          {done.hook_created ? (
            <Typography variant="body2">
              Criamos o webhook em <strong>{done.repo ?? repo}</strong>. Pull requests, issues, falhas de
              Actions e pushes na main já chegam na caixa <strong>{done.inbox.name}</strong>. Escolha nela o
              agente de IA que vai se posicionar.
            </Typography>
          ) : (
            <WebhookInstructions webhook={done} reason={done.hook_error} />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose}>Fechar</Button>
        </DialogActions>
      </Dialog>
    );

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
            void run(async () => {
              const connection = await http<Connection>('/github_channels', 'POST', { name, repo, token });
              setDone({ ...connection, repo });
              await onConnected();
            });
          },
        } as object,
      }}
    >
      <DialogTitle>Conectar repositório do GitHub</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Os eventos do repositório viram conversas, e o agente de IA da caixa comenta nos PRs e issues.
        </DialogContentText>
        <Stack spacing={2}>
          <TextField
            label="Nome da caixa"
            size="small"
            autoFocus
            placeholder="Ex.: wamcp no GitHub"
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
          />
          <TextField
            label="Repositório"
            size="small"
            placeholder="dono/repositorio"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            slotProps={{ htmlInput: { required: true, pattern: '[\\w.\\-]+/[\\w.\\-]+' } }}
          />
          <TextField
            label="Token do GitHub"
            size="small"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            slotProps={{ htmlInput: { required: true, 'aria-describedby': 'github-token-hint' } }}
          />
          <Typography id="github-token-hint" variant="caption" color="text.secondary">
            Token fine-grained só deste repositório, com permissão de escrita em Issues e Pull requests (para
            comentar) e em Webhooks (para criarmos o webhook). Ele fica guardado criptografado.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          Conectar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
