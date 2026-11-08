import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { KeyRound, Plus, Trash2 } from 'lucide-react';

import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { ConfirmModal } from '../../ui/Confirm';
import { SecretField } from '../../ui/SecretField';
import { useAction } from '../useAction';
import { formatDate, SCOPES, scopeLabel, sessionPath, type McpToken } from './model';

const DAYS = [30, 90, 180, 365];

const SELECT_SX = {
  height: 40,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1,
} as const;

/** Acesso MCP tab: the connection's MCP address and its Bearer tokens (shown once on creation). */
export function McpAccess({ id, url }: { id: string; url: string }) {
  const path = `${sessionPath(id)}/tokens`;
  const { data, error: loadError, reload } = useFetch<McpToken[]>(path);
  const [form, setForm] = useState({ name: '', scope: 'read', days: 90 }),
    [fresh, setFresh] = useState<McpToken | null>(null),
    [revoking, setRevoking] = useState<McpToken | null>(null);
  const { error, busy, run } = useAction();
  const tokens = data || [];
  const config = JSON.stringify(
    {
      mcpServers: { whatsapp: { url, headers: { Authorization: `Bearer ${fresh?.token || 'SEU_TOKEN'}` } } },
    },
    null,
    2,
  );
  return (
    <Box sx={{ display: 'flex', maxWidth: 768, flexDirection: 'column', gap: 3 }}>
      <SecretField label="Endereço MCP desta conexão" secret={url} copyLabel="Copiar endereço MCP" />
      <Typography variant="body2" color="text.secondary">
        Cada token acessa somente esta conexão. Gere uma credencial diferente para cada integração.
      </Typography>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setFresh(await http<McpToken>(path, 'POST', { ...form, name: form.name.trim() }));
            setForm({ ...form, name: '' });
            reload();
          });
        }}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1 }}
      >
        <TextField
          label="Nome da integração"
          size="small"
          placeholder="Ex.: Claude Desktop"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
          sx={{ minWidth: 192, flex: 1 }}
        />
        <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography component="span" variant="body2">
            Permissão
          </Typography>
          <Box
            component="select"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
            sx={SELECT_SX}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Box>
        </Box>
        <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography component="span" variant="body2">
            Validade
          </Typography>
          <Box
            component="select"
            value={form.days}
            onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
            sx={SELECT_SX}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </Box>
        </Box>
        <Button
          type="submit"
          variant="contained"
          startIcon={<Plus size={16} />}
          disabled={busy || !form.name.trim()}
        >
          Gerar token
        </Button>
      </Box>
      {(error || loadError) && (
        <Alert severity="error" sx={{ fontSize: 14 }}>
          {error || loadError}
        </Alert>
      )}
      {fresh?.token && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            borderRadius: 3,
            border: 1,
            borderColor: 'var(--color-n-amber-9)',
            bgcolor: 'var(--color-n-amber-3)',
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500, color: 'var(--color-n-amber-12)' }}>
            Copie agora. Este token só aparece uma vez.
          </Typography>
          <SecretField label="Token de acesso" secret={fresh.token} copyLabel="Copiar token" />
          <Typography variant="caption" sx={{ color: 'var(--color-n-amber-12)' }}>
            Expira em {formatDate(fresh.expires)}.
          </Typography>
          <Button variant="text" onClick={() => setFresh(null)} sx={{ alignSelf: 'flex-start' }}>
            Já copiei, ocultar token
          </Button>
        </Box>
      )}
      <Box
        component="ul"
        aria-label="Tokens MCP"
        sx={{ m: 0, p: 0, listStyle: 'none', borderTop: 1, borderColor: 'divider' }}
      >
        {data && tokens.length === 0 && (
          <Typography component="li" variant="body2" color="text.secondary" sx={{ py: 3 }}>
            Nenhum token criado para esta conexão.
          </Typography>
        )}
        {tokens.map((t) => (
          <Stack
            key={t.id}
            component="li"
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', py: 1.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <Box component={KeyRound} size={18} sx={{ flexShrink: 0, color: 'var(--color-n-slate-10)' }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                {t.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {scopeLabel(t.scope)} · Expira em {formatDate(t.expires)}
                {t.last_used ? ` · Último uso ${formatDate(t.last_used)}` : ''}
              </Typography>
            </Box>
            <IconButton aria-label={`Revogar ${t.name}`} onClick={() => setRevoking(t)}>
              <Trash2 size={16} />
            </IconButton>
          </Stack>
        ))}
      </Box>
      <Box>
        <Typography variant="h6" component="h3">
          Configuração do cliente
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Para clientes que aceitam URL HTTP (Streamable HTTP) e cabeçalhos personalizados.
        </Typography>
        <Box
          component="pre"
          aria-label="Configuração MCP"
          sx={{
            overflowX: 'auto',
            borderRadius: 2,
            bgcolor: 'var(--color-n-solid-3)',
            p: 1.5,
            fontSize: 12,
            m: 0,
          }}
        >
          {config}
        </Box>
      </Box>
      {revoking && (
        <ConfirmModal
          title={`Revogar ${revoking.name}?`}
          description="A integração perde o acesso imediatamente."
          confirm="Revogar"
          onConfirm={async () => {
            await http(`${path}/${encodeURIComponent(revoking.id)}`, 'DELETE');
            if (fresh?.id === revoking.id) setFresh(null);
            reload();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </Box>
  );
}
