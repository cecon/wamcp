import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../settings/c3/SettingsC3';

/** Cartão de relatório no C3Theme (lote 13): superfície com título opcional e selo AO VIVO. */
export function ReportCard({
  title,
  live,
  className,
  children,
}: {
  title?: string;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      aria-label={title}
      className={className}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        px: 3,
        py: 2.5,
      }}
    >
      {title && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          {live && <Chip size="small" color="success" label="AO VIVO" />}
        </Stack>
      )}
      {children}
    </Box>
  );
}

/** Métrica de relatório: rótulo pequeno acima do valor grande, com dica opcional embaixo. */
export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) => (
  <Box>
    <Typography variant="body2" sx={{ fontWeight: 500 }} color="text.secondary">
      {label}
    </Typography>
    <Typography variant="h5" sx={{ mt: 0.5 }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    )}
  </Box>
);

/** Moldura das páginas de relatório no C3Theme: título com filtros à direita, erro e conteúdo. */
export function ReportLayout({
  title,
  filters,
  error,
  children,
}: {
  title: string;
  filters?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <SettingsC3Page>
      <SettingsC3Header title={title} action={filters} />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      {children}
    </SettingsC3Page>
  );
}
