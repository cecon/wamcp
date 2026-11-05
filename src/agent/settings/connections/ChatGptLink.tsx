import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { ShieldCheck, Trash2 } from 'lucide-react';

import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { ConfirmModal } from '../../ui/Confirm';
import { SecretField } from '../../ui/SecretField';
import { useAction } from '../useAction';
import {
  formatDate,
  SCOPES,
  scopeLabel,
  sessionPath,
  type ChatGptGrant,
  type ChatGptLinkCode,
} from './model';

/** ChatGPT tab: one-time code for the OAuth consent page, and the authorized connections. */
export function ChatGptLink({ id, url }: { id: string; url: string }) {
  const base = `${sessionPath(id)}/chatgpt`;
  const { data, error: loadError, reload } = useFetch<ChatGptGrant[]>(base);
  const [scope, setScope] = useState('read'),
    [code, setCode] = useState<ChatGptLinkCode | null>(null),
    [revoking, setRevoking] = useState<ChatGptGrant | null>(null);
  const { error, busy, run } = useAction();
  const grants = data || [];
  return (
    <Box sx={{ display: 'flex', maxWidth: 768, flexDirection: 'column', gap: 3 }}>
      <Box
        component="ol"
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, m: 0, pl: 2.5, fontSize: 14 }}
      >
        <Typography component="li" variant="body2">
          No ChatGPT, ative o modo de desenvolvedor nas configurações, se disponível para sua conta.
        </Typography>
        <Typography component="li" variant="body2">
          Crie a conexão WA MCP com o endereço abaixo e escolha <Box component="strong">OAuth</Box>, deixando
          Client ID e Client Secret vazios.
        </Typography>
        <Typography component="li" variant="body2">
          Gere o código aqui e cole na página de autorização aberta pelo ChatGPT.
        </Typography>
      </Box>
      <SecretField
        label="URL do servidor MCP para o ChatGPT"
        secret={url}
        copyLabel="Copiar URL do ChatGPT"
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1 }}>
        <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography component="span" variant="body2">
            Permissão do ChatGPT
          </Typography>
          <Box
            component="select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            sx={{
              height: 40,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'text.primary',
              px: 1,
            }}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Box>
        </Box>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() =>
            void run(async () => setCode(await http<ChatGptLinkCode>(`${base}/link`, 'POST', { scope })))
          }
        >
          Gerar código para o ChatGPT
        </Button>
      </Box>
      {(error || loadError) && (
        <Alert severity="error" sx={{ fontSize: 14 }}>
          {error || loadError}
        </Alert>
      )}
      {code && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            borderRadius: 3,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'var(--color-n-solid-2)',
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            Código de uso único, válido por dez minutos
          </Typography>
          <SecretField label="Código para o ChatGPT" secret={code.code} copyLabel="Copiar código" />
          <Typography variant="caption" color="text.secondary">
            Expira às {new Date(code.expires).toLocaleTimeString('pt-BR')}. Cole somente na página de
            autorização do WA MCP.
          </Typography>
          <Button variant="text" onClick={() => setCode(null)} sx={{ alignSelf: 'flex-start' }}>
            Ocultar código
          </Button>
        </Box>
      )}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" component="h3">
          Conexões autorizadas
        </Typography>
        <Button variant="text" onClick={reload}>
          Atualizar
        </Button>
      </Stack>
      <Box
        component="ul"
        aria-label="Conexões do ChatGPT"
        sx={{ m: 0, p: 0, listStyle: 'none', borderTop: 1, borderColor: 'divider' }}
      >
        {data && grants.length === 0 && (
          <Typography component="li" variant="body2" color="text.secondary" sx={{ py: 3 }}>
            Nenhuma conexão do ChatGPT autorizada.
          </Typography>
        )}
        {grants.map((g) => (
          <Stack
            key={g.id}
            component="li"
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', py: 1.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <Box component={ShieldCheck} size={18} sx={{ flexShrink: 0, color: 'var(--color-n-teal-10)' }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                {g.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {scopeLabel(g.scope)} · Até {formatDate(g.expires)}
              </Typography>
            </Box>
            <IconButton aria-label={`Desconectar ${g.name}`} onClick={() => setRevoking(g)}>
              <Trash2 size={16} />
            </IconButton>
          </Stack>
        ))}
      </Box>
      {revoking && (
        <ConfirmModal
          title={`Desconectar ${revoking.name}?`}
          description="O ChatGPT perde o acesso a esta conexão até ser autorizado de novo."
          confirm="Desconectar"
          onConfirm={async () => {
            await http(`${base}/${encodeURIComponent(revoking.id)}`, 'DELETE');
            reload();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </Box>
  );
}
