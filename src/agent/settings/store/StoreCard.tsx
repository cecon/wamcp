import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// C3Theme
import { Panel, SoftAvatar, StatusChip } from '@c3theme/ui';

import { StoreIcon } from './icons';

interface Props {
  name: string;
  category: string;
  description: string;
  version: string;
  icon: string;
  /** One line under the description: what is installed here, what is missing. */
  status?: ReactNode;
  actions: ReactNode;
}

/** A store card: icon, name, category, description, version and the actions. */
export function StoreCard({ name, category, description, version, icon, status, actions }: Props) {
  return (
    <Box component="article" aria-label={name} sx={{ display: 'flex' }}>
      {/* O Panel desta versão do pacote não tem `footer`: o corpo vira coluna e estica para as ações
          ficarem na base quando os cartões da linha têm descrições de tamanhos diferentes. */}
      <Panel
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          '& > *': { flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 },
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <SoftAvatar tone="primary" look="filled" variant="rounded" aria-hidden>
            <StoreIcon name={icon} size={20} />
          </SoftAvatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
              {name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              v{version}
            </Typography>
          </Box>
          {category && (
            <Box sx={{ ml: 'auto !important' }}>
              <StatusChip label={category} tone="neutral" />
            </Box>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {description}
        </Typography>
        {status}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {actions}
        </Stack>
      </Panel>
    </Box>
  );
}

/** The cards in a responsive grid. */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
      }}
    >
      {children}
    </Box>
  );
}
