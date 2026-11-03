// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { CheckCircle2, XCircle } from 'lucide-react';

/** One step checked while connecting a repository (token, repository, webhook). */
export interface GithubCheck {
  step: 'token' | 'repository' | 'webhook';
  ok: boolean;
  detail?: string | null;
}

const STEP: Record<GithubCheck['step'], string> = {
  token: 'Token',
  repository: 'Repositório',
  webhook: 'Webhook',
};

function sentence(check: GithubCheck) {
  const detail = check.detail || '';
  if (check.step === 'token')
    return check.ok ? `Token autenticado${detail ? ` como ${detail}` : ''}` : detail;
  if (check.step === 'repository') return check.ok ? `Repositório ${detail} acessível` : detail;
  return check.ok ? 'Webhook criado e assinando as entregas' : `Webhook não criado: ${detail}`;
}

/**
 * O que aconteceu ao conectar: token → repositório → webhook. Fica na tela de criação para o
 * administrador ver na hora o que funcionou e o que precisa de conserto.
 */
export function GithubChecks({ checks }: { checks: GithubCheck[] }) {
  return (
    <Stack spacing={0.75} component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {checks.map((check) => (
        <Stack
          key={check.step}
          component="li"
          direction="row"
          spacing={1}
          sx={{ alignItems: 'flex-start', color: check.ok ? 'success.main' : 'error.main' }}
        >
          <Box sx={{ display: 'flex', pt: 0.25 }}>
            {check.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          </Box>
          <Typography variant="body2" color="text.primary">
            <strong>{STEP[check.step]}:</strong> {sentence(check)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
