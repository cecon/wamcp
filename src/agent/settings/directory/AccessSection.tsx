// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { RosterAgent } from '../../adminTypes';
import type { Role } from '../../types';
import type { NewAccess } from './access';

interface Props {
  agent: RosterAgent | null;
  access: NewAccess;
  onChange: (access: NewAccess) => void;
  /** Opens the login settings (access type, two-step verification, deactivation). */
  onManage: (userId: number) => void;
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

/** Optional helpdesk access of a person: shown when linked, or created with e-mail and password. */
export function AccessSection({ agent, access, onChange, onManage }: Props) {
  if (agent?.user_id) {
    const userId = agent.user_id;
    return (
      <Box
        component="fieldset"
        aria-label="Acesso ao helpdesk"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, border: 0, m: 0, p: 0 }}
      >
        <Typography component="legend" variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
          Acesso ao helpdesk
        </Typography>
        <Typography variant="body2">{agent.user_email}</Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => onManage(userId)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Gerenciar acesso
        </Button>
      </Box>
    );
  }
  return (
    <Box
      component="fieldset"
      aria-label="Acesso ao helpdesk"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, border: 0, m: 0, p: 0 }}
    >
      <Typography component="legend" variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
        Acesso ao helpdesk
      </Typography>
      <Box
        component="label"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 14, color: 'var(--color-n-slate-12)' }}
      >
        <Checkbox
          size="small"
          checked={access.enabled}
          onChange={(e) => onChange({ ...access, enabled: e.target.checked })}
          sx={{ p: 0.5 }}
        />
        Dar acesso ao helpdesk (entrar e atender conversas)
      </Box>
      {access.enabled && (
        <>
          <TextField
            label="E-mail"
            type="email"
            size="small"
            value={access.email}
            onChange={(e) => onChange({ ...access, email: e.target.value })}
            slotProps={{ htmlInput: { required: true } }}
          />
          <TextField
            label="Senha inicial (mín. 10 caracteres)"
            type="password"
            size="small"
            autoComplete="new-password"
            value={access.password}
            onChange={(e) => onChange({ ...access, password: e.target.value })}
            slotProps={{ htmlInput: { minLength: 10, required: true } }}
          />
          <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography component="span" variant="body2">
              Tipo de acesso
            </Typography>
            <Box
              component="select"
              value={access.role}
              onChange={(e) => onChange({ ...access, role: e.target.value as Role })}
              sx={SELECT_SX}
            >
              <option value="agent">Agente</option>
              <option value="administrator">Administrador</option>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
