import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

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
    <Box
      component="article"
      aria-label={name}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 1.5,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <StoreIcon name={icon} size={20} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            v{version}
          </Typography>
        </Box>
        {category && <Chip size="small" label={category} sx={{ ml: 'auto !important' }} />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
        {description}
      </Typography>
      {status && <Box sx={{ fontSize: 13 }}>{status}</Box>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {actions}
      </Stack>
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
