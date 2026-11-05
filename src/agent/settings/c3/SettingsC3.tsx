import type { ReactNode } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Search } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';

import C3Provider from '../../c3/C3Provider';

/**
 * Peças comuns das telas de Configurações migradas (lote 2 em diante): provider do C3Theme no escopo da seção,
 * a moldura da página, o cabeçalho padrão (título, descrição, busca, contagem e ação) e o aviso de erro.
 *
 * A tela monta: `<SettingsC3Page><SettingsC3Header …/><Panel flush>…tabela…</Panel></SettingsC3Page>`.
 */
export function SettingsC3Page({ children }: { children: ReactNode }) {
  return (
    <C3Provider>
      <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default', p: { xs: 2, md: 3 } }}>
        <Stack spacing={2} sx={{ maxWidth: 1100, mx: 'auto' }}>
          {children}
        </Stack>
      </Box>
    </C3Provider>
  );
}

interface HeaderProps {
  title: string;
  description?: string;
  count?: string;
  action?: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
}

export function SettingsC3Header({ title, description, count, action, search }: HeaderProps) {
  return (
    <Panel>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h4">{title}</Typography>
            {description && (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        {(search || count) && (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            {search ? (
              <OutlinedInput
                size="small"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={search.placeholder}
                startAdornment={
                  <InputAdornment position="start">
                    <Search size={14} />
                  </InputAdornment>
                }
                slotProps={{ input: { 'aria-label': search.placeholder } }}
                sx={{ width: 260 }}
              />
            ) : (
              <span />
            )}
            {count && (
              <Typography variant="body2" color="text.secondary">
                {count}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Panel>
  );
}

/** Erro de carga/ação no mesmo lugar das telas antigas (role="alert" continua). */
export function SettingsC3Error({ children }: { children: ReactNode }) {
  return <Alert severity="error">{children}</Alert>;
}
