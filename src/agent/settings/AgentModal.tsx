import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { CustomRole } from '../adminTypes';
import C3Provider from '../c3/C3Provider';
import type { Catalog, Role, User } from '../types';
import { useAction } from './useAction';

interface Props {
  agent?: User;
  catalog: Catalog;
  roles: CustomRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const SELECT_SX = {
  height: 40,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1,
} as const;

/** Add / edit agent: name, role, mandatory profile ("Perfil"); new agents also get e-mail, password and inboxes. */
export function AgentModal({ agent, catalog, roles, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: agent?.name || '',
    email: '',
    password: '',
    role: agent?.role || ('agent' as Role),
  });
  const fallback = roles.find((r) => r.builtin)?.id ?? null;
  const current = agent?.custom_role_id ?? null;
  const [profile, setProfile] = useState<number | null>(current ?? fallback);
  const [inboxIds, setInboxIds] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  const roleChange = profile !== null && profile !== current ? { custom_role_id: profile } : {};

  async function save() {
    if (agent) {
      await http(`/agents/${agent.id}`, 'PATCH', { name: form.name, role: form.role, ...roleChange });
    } else {
      const created = await http<User>('/agents', 'POST', { ...form, inbox_ids: inboxIds });
      if (profile !== null && profile !== created.custom_role_id)
        await http(`/agents/${created.id}`, 'PATCH', { custom_role_id: profile });
    }
    await onSaved();
    onClose();
  }
  const once = (action: () => Promise<unknown>) =>
    void run(async () => {
      await action();
      await onSaved();
      onClose();
    });

  return (
    <C3Provider>
      <ActionDialog
        open
        title={agent ? `Editar ${agent.name}` : 'Adicionar agente'}
        description={agent ? undefined : 'Crie o acesso e escolha as caixas de entrada que o agente atende.'}
        confirmLabel={agent ? 'Salvar' : 'Adicionar agente'}
        backLabel="Cancelar"
        loading={busy}
        error={error || undefined}
        onClose={onClose}
        onConfirm={() => void run(save)}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome do agente"
            size="small"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
          />
          <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography component="span" variant="body2">
              Função
            </Typography>
            <Box
              component="select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              sx={SELECT_SX}
            >
              <option value="agent">Agente</option>
              <option value="administrator">Administrador</option>
            </Box>
          </Box>
          {roles.length > 0 && (
            <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography component="span" variant="body2">
                Perfil
              </Typography>
              <Box
                component="select"
                value={profile ?? ''}
                onChange={(e) => setProfile(Number(e.target.value))}
                sx={SELECT_SX}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Box>
            </Box>
          )}
          {!agent && (
            <>
              <TextField
                label="E-mail"
                type="email"
                size="small"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                slotProps={{ htmlInput: { required: true } }}
              />
              <TextField
                label="Senha inicial (mín. 10 caracteres)"
                type="password"
                size="small"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                slotProps={{ htmlInput: { minLength: 10, required: true } }}
              />
              <Box component="fieldset" sx={{ border: 0, m: 0, p: 0 }}>
                <Typography component="legend" variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                  Caixas de entrada
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {catalog.inboxes.map((i) => (
                    <Box
                      key={i.id}
                      component="label"
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 14 }}
                    >
                      <Checkbox
                        size="small"
                        checked={inboxIds.includes(i.id)}
                        onChange={() =>
                          setInboxIds((ids) =>
                            ids.includes(i.id) ? ids.filter((x) => x !== i.id) : [...ids, i.id],
                          )
                        }
                        sx={{ p: 0.5 }}
                      />
                      {i.name}
                    </Box>
                  ))}
                </Box>
              </Box>
            </>
          )}
          {agent?.mfa_enabled ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Button
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => once(() => http(`/agents/${agent.id}/mfa`, 'DELETE'))}
              >
                Redefinir verificação em duas etapas
              </Button>
              <Typography variant="caption" color="text.secondary">
                Use quando o agente perder o aplicativo autenticador; ele entrará só com a senha.
              </Typography>
            </Box>
          ) : null}
          {agent && (
            <Button
              color="error"
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => once(() => http(`/agents/${agent.id}`, 'PATCH', { active: !agent.active }))}
            >
              {agent.active ? 'Desativar acesso' : 'Reativar acesso'}
            </Button>
          )}
        </Stack>
      </ActionDialog>
    </C3Provider>
  );
}
