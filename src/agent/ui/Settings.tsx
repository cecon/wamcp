import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

// third-party
import { ArrowLeft, Pencil as PencilIcon, Search, Trash2 as TrashIcon } from 'lucide-react';

interface HeaderProps {
  title: string;
  description?: string;
  back?: { label: string; onClick: () => void };
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  count?: string;
  action?: ReactNode;
}

/** Cabeçalho de Configurações no C3Theme: título, descrição e a linha busca · contagem · ação. */
export function SettingsHeader({ title, description, back, search, count, action }: HeaderProps) {
  return (
    <Stack component="header" spacing={1}>
      {back && (
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowLeft size={14} />}
          onClick={back.onClick}
          sx={{ alignSelf: 'flex-start', px: 0, textTransform: 'none' }}
        >
          {back.label}
        </Button>
      )}
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 800 }}>
          {description}
        </Typography>
      )}
      {(search || count || action) && (
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ mt: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}
        >
          {search ? (
            <OutlinedInput
              size="small"
              value={search.value}
              placeholder={search.placeholder}
              onChange={(e) => search.onChange(e.target.value)}
              startAdornment={
                <InputAdornment position="start">
                  <Search size={14} />
                </InputAdornment>
              }
              slotProps={{ input: { 'aria-label': search.placeholder } }}
              sx={{ width: 224 }}
            />
          ) : (
            <span />
          )}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {count && (
              <Typography variant="body2" color="text.secondary">
                {count}
              </Typography>
            )}
            {count && action && <Box sx={{ width: 1, height: 12, bgcolor: 'divider' }} />}
            {action}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

/** Moldura de página de Configurações no C3Theme. */
export function SettingsPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        overflow: 'auto',
        bgcolor: 'background.default',
        px: 3,
        pt: 2,
        pb: 4,
      }}
    >
      <Stack spacing={2} sx={{ mx: 'auto', maxWidth: wide ? 1280 : 1100 }}>
        {children}
      </Stack>
    </Box>
  );
}

interface TableProps {
  headers: ReactNode[];
  empty: string;
  children: ReactNode;
  rows: number;
}

/** Tabela simples no C3Theme (mantém `<tr>` por linha para os testes que usam `closest('tr')`). */
export function Table({ headers, empty, children, rows }: TableProps) {
  return (
    <Box
      component="table"
      sx={{ width: '100%', borderTop: 1, borderColor: 'divider', borderCollapse: 'collapse' }}
    >
      <Box component="thead">
        <Box component="tr">
          {headers.map((h, i) => (
            <Box
              component="th"
              key={i}
              sx={{ py: 2, pr: 2, textAlign: 'start', fontSize: 14, fontWeight: 600 }}
            >
              {h}
            </Box>
          ))}
        </Box>
      </Box>
      <Box component="tbody">
        {rows === 0 ? (
          <Box component="tr">
            <Box component="td" colSpan={headers.length} sx={{ py: 10, textAlign: 'center' }}>
              {empty}
            </Box>
          </Box>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
}

export const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <Box
    component="td"
    className={className}
    sx={{ py: 1.5, pr: 2, verticalAlign: 'middle', color: 'text.secondary', fontSize: 14 }}
  >
    {children}
  </Box>
);

/** Editar/excluir usados nas linhas de Configurações. */
export function RowActions({
  onEdit,
  onDelete,
  labelFor,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  labelFor: string;
}) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
      {onEdit && (
        <IconButton size="small" aria-label={`Editar ${labelFor}`} onClick={onEdit}>
          <PencilIcon size={16} />
        </IconButton>
      )}
      {onDelete && (
        <IconButton size="small" aria-label={`Excluir ${labelFor}`} color="error" onClick={onDelete}>
          <TrashIcon size={16} />
        </IconButton>
      )}
    </Stack>
  );
}

export function ModalFooter({
  busy,
  submit,
  onCancel,
  error,
}: {
  busy?: boolean;
  submit: string;
  onCancel: () => void;
  error?: string;
}) {
  return (
    <>
      {error && (
        <Typography variant="body2" role="alert" sx={{ mt: 1.5, color: 'error.main' }}>
          {error}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 3 }}>
        <Button variant="outlined" color="inherit" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={busy}>
          {submit}
        </Button>
      </Stack>
    </>
  );
}

/** Linha de switch (rótulo/dica à esquerda, switch à direita); `compact` mostra só o switch. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  compact,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex',
        cursor: 'pointer',
        alignItems: compact ? 'center' : 'flex-start',
        justifyContent: compact ? 'flex-end' : 'space-between',
        gap: 2,
        py: compact ? 0 : 1.5,
      }}
    >
      <Box
        sx={
          compact
            ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }
            : undefined
        }
      >
        <Typography variant="subtitle2" component="span" sx={{ display: 'block' }}>
          {label}
        </Typography>
        {hint && (
          <Typography
            variant="caption"
            component="span"
            color="text.secondary"
            sx={{ display: 'block', fontWeight: 400 }}
          >
            {hint}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        slotProps={{ input: { role: 'switch', 'aria-label': label } }}
        size="small"
      />
    </Box>
  );
}
