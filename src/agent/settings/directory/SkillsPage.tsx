import { useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

import { FileUp, Plus } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { ConfirmModal } from '../../ui/Confirm';
import { RowActions } from '../../ui/Settings';
import { useAction } from '../useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import { SkillModal } from './SkillModal';

/** Skill library: what operators know how to do, written here or imported from a SKILL.md. */
export function SkillsPage() {
  const { data, error, reload } = useFetch<Skill[]>('/skills');
  const [editing, setEditing] = useState<Skill | 'new' | null>(null),
    [removing, setRemoving] = useState<Skill | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const importing = useAction();
  const skills = data || [];

  const columns: ColumnDef<Skill>[] = [
    {
      id: 'skill',
      header: 'Skill',
      accessorFn: (skill) => skill.name,
      cell: (info) => (
        <Box>
          <Typography variant="body2" component="span" sx={{ display: 'block', fontWeight: 500 }}>
            {info.row.original.name}
          </Typography>
          {info.row.original.description && (
            <Typography variant="caption" color="text.secondary" component="span">
              {info.row.original.description}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'tools',
      header: 'Ferramentas',
      accessorFn: (skill) => skill.tools.join(', ') || '—',
      cell: (info) => (
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => (
        <RowActions
          labelFor={info.row.original.name}
          onEdit={() => setEditing(info.row.original)}
          onDelete={() => setRemoving(info.row.original)}
        />
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Skills"
        description="Instruções e ferramentas que os agentes de IA executores usam. Importe um SKILL.md no formato do Claude Code (cabeçalho com name, description e allowed-tools) ou escreva aqui."
        count={`${skills.length} skill${skills.length === 1 ? '' : 's'}`}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<FileUp size={16} />}
              disabled={importing.busy}
              onClick={() => file.current?.click()}
            >
              Importar SKILL.md
            </Button>
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Adicionar skill
            </Button>
          </Stack>
        }
      />
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        aria-label="Arquivo SKILL.md"
        style={{ display: 'none' }}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (!chosen) return;
          void importing.run(async () => {
            await http('/skills/import', 'POST', { content: await chosen.text() });
            reload();
          });
        }}
      />
      {(error || importing.error) && <SettingsC3Error>{error || importing.error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={skills}
          columns={columns}
          getRowId={(skill) => String(skill.id)}
          empty="Nenhuma skill ainda."
          ariaLabel="Skills"
        />
      </Panel>
      {editing && (
        <SkillModal
          skill={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir a skill “${removing.name}”?`}
          description="Os agentes que a usam deixam de tê-la."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/skills/${removing.id}`, 'DELETE');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsC3Page>
  );
}
