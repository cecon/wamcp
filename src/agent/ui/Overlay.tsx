import { useEffect, useRef, useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Modal no C3Theme: diálogo com título acessível, “Fechar”, Esc e clique fora. */
export function Modal({ title, description, onClose, children }: ModalProps) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, pr: 1 }}
      >
        <Box>
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}
        </Box>
        <IconButton aria-label="Fechar" size="small" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}

/** Painel lateral no C3Theme (drawer direito) com título e “Fechar”. */
export function SidePanel({ title, description, onClose, children }: ModalProps) {
  return (
    <Drawer
      open
      anchor="right"
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': title,
          sx: { width: 640, maxWidth: 'calc(100vw - 24px)', display: 'flex', flexDirection: 'column' },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
          px: 3,
          py: 2,
        }}
      >
        <Box>
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
        <IconButton aria-label="Fechar" size="small" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>{children}</Box>
    </Drawer>
  );
}

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  placement?: 'bottom' | 'top';
  className?: string;
}

/** Dropdown do C3Theme: gatilho + painel `role="menu"` que fecha com Esc, clique fora ou item escolhido. */
export function Dropdown({
  trigger,
  children,
  align = 'end',
  placement = 'bottom',
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <Box ref={ref} sx={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <Box
          role="menu"
          className={className}
          sx={{
            position: 'absolute',
            zIndex: 30,
            minWidth: 156,
            display: 'grid',
            gap: 0.5,
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            p: 1,
            fontSize: 14,
            boxShadow: 3,
            ...(align === 'end' ? { right: 0 } : { left: 0 }),
            ...(placement === 'bottom' ? { top: '100%', mt: 0.5 } : { bottom: '100%', mb: 0.5 }),
          }}
        >
          {children(close)}
        </Box>
      )}
    </Box>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon?: (props: { size?: number; className?: string }) => ReactNode;
  label: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <ButtonBase
      role="menuitem"
      onClick={onClick}
      sx={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1.5,
        borderRadius: 1,
        p: 1,
        textAlign: 'left',
        color: danger ? 'error.main' : 'text.primary',
        bgcolor: active ? 'action.hover' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {Icon && <Icon size={16} className={danger ? 'text-n-ruby-11' : 'text-n-slate-11'} />}
      {label}
    </ButtonBase>
  );
}
