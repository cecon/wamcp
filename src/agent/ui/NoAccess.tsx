// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Lock } from 'lucide-react';

/** Mostrado quando o perfil do agente não permite a página (ou o servidor respondeu 403). */
export function NoAccess() {
  return (
    <Stack
      role="alert"
      spacing={1}
      sx={{
        height: '100%',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        textAlign: 'center',
      }}
    >
      <Box sx={{ display: 'flex', color: 'text.disabled' }}>
        <Lock size={24} />
      </Box>
      <Typography variant="h5" component="p">
        Você não tem acesso a esta página
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 384 }}>
        Seu perfil não inclui esta permissão. Fale com um administrador se precisar de acesso.
      </Typography>
    </Stack>
  );
}
