// material-ui
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

// third-party
import { X } from 'lucide-react';

/** Shortcuts shown in the help (Chatwoot keyboard shortcuts modal). */
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['?'], label: 'Mostrar os atalhos de teclado' },
  { keys: ['Ctrl / ⌘', 'K'], label: 'Abrir a pesquisa' },
  { keys: ['Alt', 'J'], label: 'Próxima conversa' },
  { keys: ['Alt', 'K'], label: 'Conversa anterior' },
  { keys: ['Alt', 'E'], label: 'Resolver conversa' },
  { keys: ['Alt', 'O'], label: 'Reabrir conversa' },
  { keys: ['Alt', 'A'], label: 'Atribuir a mim' },
  { keys: ['Alt', 'L'], label: 'Adicionar etiquetas' },
  { keys: ['/'], label: 'Ir para o editor de mensagem' },
  { keys: ['Ctrl / ⌘', 'Enter'], label: 'Enviar mensagem' },
  { keys: ['Shift', 'Enter'], label: 'Nova linha na mensagem' },
  { keys: ['Esc'], label: 'Fechar janelas' },
];

/** Chatwoot "Atalhos do teclado" modal: one row per action with its key chips. */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 7 }}>
        Atalhos de teclado
        <IconButton
          size="small"
          aria-label="Fechar"
          onClick={onClose}
          sx={{ position: 'absolute', top: 10, right: 10 }}
        >
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Os atalhos não funcionam enquanto você digita em um campo, exceto os do editor.
        </Typography>
        <Box
          component="ul"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            columnGap: 4,
            m: 0,
            p: 0,
            listStyle: 'none',
          }}
        >
          {SHORTCUTS.map((s) => (
            <Box
              component="li"
              key={s.label}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                py: 1,
              }}
            >
              <Typography component="span" variant="body2">
                {s.label}
              </Typography>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0, gap: 0.5 }}>
                {s.keys.map((key) => (
                  <Box
                    component="kbd"
                    key={key}
                    sx={{
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      px: 0.75,
                      py: 0.25,
                      fontFamily: 'inherit',
                      fontSize: 12,
                      border: 1,
                      borderColor: 'divider',
                    }}
                  >
                    {key}
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
