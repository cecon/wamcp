import type { ReactNode } from 'react';

// material-ui
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Typography from '@mui/material/Typography';

// third-party
import { ChevronDown } from 'lucide-react';

/** Um bloco recolhido da página: o título e uma linha do que tem dentro. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Accordion disableGutters variant="outlined" slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ChevronDown size={18} />}>
        <Typography variant="subtitle1" component="h2" sx={{ mr: 1.5 }}>
          {title}
        </Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {hint}
          </Typography>
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}
