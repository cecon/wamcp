import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { CircleDot, Flag, Tag, UserRound, Users, Workflow, X } from 'lucide-react';

import { http } from '../api';
import type { BulkResult, Catalog, ConversationStatus } from '../types';
import { PRIORITY_LABEL } from '../labels';
import { executeMacro, useMacros } from '../macros/useMacros';
import type { Macro } from '../accountTypes';

type Fields = Partial<{
  status: ConversationStatus;
  snoozed_until: number;
  assignee_id: number | null;
  team_id: number | null;
  priority: string | null;
}>;
interface Change {
  fields?: Fields;
  labels?: { add?: string[]; remove?: string[] };
}
interface Option<T = Change> {
  label: string;
  change: T;
}

const STATUS_OPTIONS: Option[] = [
  { label: 'Abrir', change: { fields: { status: 'open' } } },
  { label: 'Resolver', change: { fields: { status: 'resolved' } } },
  { label: 'Marcar como pendente', change: { fields: { status: 'pending' } } },
];

/** Menu de ação em massa no C3Theme (lote 23): `IconButton` com `aria-label` e `MenuItem`s. */
function ActionMenu<T>({
  icon: Icon,
  label,
  options,
  onPick,
}: {
  icon: typeof Tag;
  label: string;
  options: Option<NoInfer<T>>[];
  onPick: (change: T) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton size="small" aria-label={label} onClick={(event) => setAnchor(event.currentTarget)}>
        <Icon size={16} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 256, width: 224 } } }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.label}
            onClick={() => {
              setAnchor(null);
              onPick(option.change);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

interface Props {
  selected: number[];
  total: number;
  catalog: Catalog;
  onSelectAll: (all: boolean) => void;
  onClear: () => void;
  onDone: (updated: number[]) => void;
}

/** Barra de ações em massa no C3Theme (lote 23): selecionar todas, status, agente, time, prioridade, macros e etiquetas. */
export function BulkActionBar({ selected, total, catalog, onSelectAll, onClear, onDone }: Props) {
  const [result, setResult] = useState<ReactNode>(null);
  const { macros } = useMacros();
  function apply(change: Change) {
    // "Adiar até amanhã" is timed when applied, not when the bar renders.
    const fields =
      change.fields?.status === 'snoozed'
        ? { ...change.fields, snoozed_until: Math.floor(Date.now() / 1000) + 86400 }
        : change.fields;
    return report(http<BulkResult>('/bulk_actions', 'POST', { ids: selected, ...change, fields }));
  }
  /** Bulk actions and macros answer `{updated, failed}`; failures are listed per conversation. */
  async function report(request: Promise<BulkResult>) {
    try {
      const r = await request;
      setResult(
        r.failed.length ? (
          <Box
            component="ul"
            role="alert"
            sx={{ m: 0, pl: 2, color: 'error.main', fontSize: 12, listStyle: 'none' }}
          >
            {r.failed.map((f) => (
              <Box component="li" key={f.id}>
                #{f.id}: {f.error}
              </Box>
            ))}
          </Box>
        ) : null,
      );
      onDone(r.updated);
    } catch (e) {
      setResult(
        <Typography variant="caption" role="alert" sx={{ color: 'error.main' }}>
          {(e as Error).message}
        </Typography>,
      );
    }
  }
  const none = (key: 'assignee_id' | 'team_id', label: string): Option => ({
    label,
    change: { fields: { [key]: null } },
  });
  return (
    <Box
      role="toolbar"
      aria-label="Ações em massa"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        px: 1.5,
        py: 1,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Checkbox
          size="small"
          checked={selected.length === total}
          onChange={(event) => onSelectAll(event.target.checked)}
          slotProps={{ input: { 'aria-label': 'Selecionar todas' } }}
        />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 500 }}>
          {selected.length} selecionada(s)
        </Typography>
        <ActionMenu
          icon={CircleDot}
          label="Alterar status"
          options={[
            ...STATUS_OPTIONS,
            { label: 'Adiar até amanhã', change: { fields: { status: 'snoozed' } } },
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <ActionMenu
          icon={UserRound}
          label="Atribuir agente"
          options={[
            none('assignee_id', 'Remover agente'),
            ...catalog.agents.map((a) => ({ label: a.name, change: { fields: { assignee_id: a.id } } })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <ActionMenu
          icon={Users}
          label="Atribuir time"
          options={[
            none('team_id', 'Remover time'),
            ...catalog.teams.map((t) => ({ label: t.name, change: { fields: { team_id: t.id } } })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <ActionMenu
          icon={Flag}
          label="Alterar prioridade"
          options={[
            { label: 'Nenhuma', change: { fields: { priority: null } } },
            ...Object.entries(PRIORITY_LABEL).map(([id, label]) => ({
              label,
              change: { fields: { priority: id } },
            })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        {macros.length > 0 && (
          <ActionMenu
            icon={Workflow}
            label="Executar macro"
            options={macros.map((m) => ({ label: m.name, change: m }))}
            onPick={(m: Macro) => void report(executeMacro(m, selected))}
          />
        )}
        <ActionMenu
          icon={Tag}
          label="Etiquetas"
          options={catalog.labels.flatMap((l) => [
            { label: `Adicionar ${l.title}`, change: { labels: { add: [l.title] } } },
            { label: `Remover ${l.title}`, change: { labels: { remove: [l.title] } } },
          ])}
          onPick={(c: Change) => void apply(c)}
        />
        <IconButton size="small" aria-label="Limpar seleção" onClick={onClear}>
          <X size={16} />
        </IconButton>
      </Stack>
      {result}
    </Box>
  );
}
