import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

// third-party
import { Minus, Plus } from 'lucide-react';

/** Seção acordeão do C3Theme: barra de título com +/− e corpo que desmonta ao fechar. */
export function Accordion({
  title,
  open: initial = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <Box component="section">
      <Button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        variant="text"
        fullWidth
        endIcon={open ? <Minus size={16} /> : <Plus size={16} />}
        sx={{
          justifyContent: 'space-between',
          borderRadius: 1,
          bgcolor: 'action.hover',
          px: 2,
          py: 1,
          textTransform: 'none',
          color: 'text.primary',
          fontSize: 14,
        }}
      >
        {title}
      </Button>
      {open && <Box sx={{ borderRadius: '0 0 8px 8px', px: 1, py: 2 }}>{children}</Box>}
    </Box>
  );
}
