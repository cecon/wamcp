import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Pencil, Plus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog, Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { AttributeDefinition, FilterType } from '../types';
import { ATTRIBUTE_MODEL_LABEL, ATTRIBUTE_TYPE_LABEL } from '../labels';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import { AttributeModal } from './AttributeModal';
import { SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

/** Configurações → Atributos personalizados no C3Theme (lote 3). Contratos: abas, tabela, diálogos e ações. */
export function AttributesPage() {
  const { definitions, reload } = useAttributeDefinitions();
  const [model, setModel] = useState<FilterType>('conversation'),
    [editing, setEditing] = useState<AttributeDefinition | 'new' | null>(null),
    [deleting, setDeleting] = useState<AttributeDefinition | null>(null);
  const visible = definitions.filter((definition) => definition.attribute_model === model);
  const count = `${visible.length} atributo${visible.length === 1 ? '' : 's'}`;

  const columns: ColumnDef<AttributeDefinition>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorKey: 'attribute_display_name',
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {info.row.original.attribute_display_name}
        </Typography>
      ),
    },
    {
      id: 'key',
      header: 'Chave',
      accessorKey: 'attribute_key',
      cell: (info) => (
        <Typography variant="caption" color="text.secondary">
          {info.row.original.attribute_key}
        </Typography>
      ),
    },
    {
      id: 'type',
      header: 'Tipo',
      accessorFn: (definition) => ATTRIBUTE_TYPE_LABEL[definition.attribute_display_type],
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    },
    {
      id: 'description',
      header: 'Descrição',
      accessorFn: (definition) => definition.attribute_description || '—',
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton
            size="small"
            aria-label={`Editar ${info.row.original.attribute_display_name}`}
            onClick={() => setEditing(info.row.original)}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={`Excluir ${info.row.original.attribute_display_name}`}
            onClick={() => setDeleting(info.row.original)}
          >
            <Trash2 size={14} />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Atributos personalizados"
        description="Guarde informações extras de conversas e contatos, como plano contratado ou data da compra."
        count={count}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Adicionar atributo
          </Button>
        }
      />
      <Panel>
        <Tabs
          value={model}
          onChange={(_event, value: FilterType) => setModel(value)}
          aria-label="Aplica-se a"
        >
          {(['conversation', 'contact'] as const).map((value) => (
            <Tab key={value} value={value} label={ATTRIBUTE_MODEL_LABEL[value]} />
          ))}
        </Tabs>
      </Panel>
      <Panel flush>
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(definition) => String(definition.id)}
          paginate={visible.length > 10}
          empty="Nenhum atributo personalizado ainda."
          ariaLabel="Atributos personalizados"
        />
      </Panel>
      {editing && (
        <AttributeModal
          definition={editing === 'new' ? null : editing}
          model={model}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {deleting && (
        <ActionDialog
          open
          title="Excluir atributo"
          description={`O atributo “${deleting.attribute_display_name}” será removido das definições.`}
          confirmLabel="Excluir"
          backLabel="Cancelar"
          tone="danger"
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            void http(`/custom_attribute_definitions/${deleting.id}`, 'DELETE')
              .then(() => reload())
              .then(() => setDeleting(null))
          }
        />
      )}
    </SettingsC3Page>
  );
}
