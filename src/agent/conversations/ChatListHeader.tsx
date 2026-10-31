import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { ArrowDownWideNarrow, ArrowUpDown } from 'lucide-react';

import type { ConversationStatus } from '../types';
import { SORT_LABEL, STATUS_LABEL } from '../labels';

export type StatusFilter = ConversationStatus | 'all';
const CHIP: Record<StatusFilter, string> = {
  open: 'Abertas',
  pending: 'Pendentes',
  snoozed: 'Adiadas',
  resolved: 'Resolvidas',
  all: 'Todas',
};

/** Popover de seleção no C3Theme (lote 15): botão com `aria-label` e `select` nativo dentro do menu. */
function SelectPopover<T extends string>({
  icon: Icon,
  label,
  field,
  value,
  options,
  onChange,
}: {
  icon: typeof ArrowUpDown;
  label: string;
  field: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton size="small" aria-label={label} onClick={(event) => setAnchor(event.currentTarget)}>
        <Icon size={16} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box component="label" sx={{ display: 'grid', gap: 0.75, p: 1.5, fontSize: 14 }}>
          {field}
          <Box
            component="select"
            value={value}
            onChange={(event) => {
              onChange(event.target.value as T);
              setAnchor(null);
            }}
            sx={{ height: 32, py: 0.5, px: 1, borderRadius: 1, border: 1, borderColor: 'divider' }}
          >
            {(Object.keys(options) as T[]).map((option) => (
              <option key={option} value={option}>
                {options[option]}
              </option>
            ))}
          </Box>
        </Box>
      </Menu>
    </>
  );
}

const STATUS_OPTIONS = Object.fromEntries(
  (Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => [s, CHIP[s]]),
) as Record<StatusFilter, string>;

interface Props {
  title: string;
  status: StatusFilter;
  sort: string;
  /** Advanced filter active: status and sort do not apply to POST /conversations/filter. */
  filtering: boolean;
  toolbar?: ReactNode;
  onStatus: (status: StatusFilter) => void;
  onSort: (sort: string) => void;
}

/** Cabeçalho da lista de conversas no C3Theme (lote 15): título, chip de status, toolbar e popovers. */
export function ChatListHeader({ title, status, sort, filtering, toolbar, onStatus, onSort }: Props) {
  return (
    <Stack
      component="header"
      direction="row"
      spacing={1}
      sx={{
        minHeight: 52,
        px: 1.5,
        py: 1,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, alignItems: 'center' }}>
        <Typography variant="h6" component="h1" noWrap sx={{ fontSize: '1rem', fontWeight: 500 }}>
          {title}
        </Typography>
        {!filtering && <Chip size="small" label={CHIP[status]} sx={{ textTransform: 'capitalize' }} />}
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        {toolbar}
        {!filtering && (
          <>
            <SelectPopover
              icon={ArrowDownWideNarrow}
              label="Ordenar conversas"
              field="Ordenar por"
              value={sort}
              options={SORT_LABEL}
              onChange={onSort}
            />
            <SelectPopover
              icon={ArrowUpDown}
              label="Filtrar por status"
              field="Status"
              value={status}
              options={STATUS_OPTIONS}
              onChange={onStatus}
            />
          </>
        )}
      </Stack>
    </Stack>
  );
}
