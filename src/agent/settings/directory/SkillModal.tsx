import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import C3Provider from '../../c3/C3Provider';
import { useAction } from '../useAction';

interface Props {
  skill: Skill | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Skill form: name, description, instructions (markdown) and the MCP tools it may call. */
export function SkillModal({ skill, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: skill?.name || '',
    description: skill?.description || '',
    instructions: skill?.instructions || '',
    tools: skill?.tools.join(', ') || '',
  });
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <C3Provider>
      <ActionDialog
        open
        title={skill ? 'Editar skill' : 'Adicionar skill'}
        description="As instruções dizem ao agente como executar; as ferramentas limitam o que ele pode chamar."
        confirmLabel={skill ? 'Atualizar skill' : 'Criar skill'}
        backLabel="Cancelar"
        loading={busy}
        error={error}
        onClose={onClose}
        onConfirm={() =>
          void run(async () => {
            const body = {
              name: form.name.trim(),
              description: form.description.trim() || null,
              instructions: form.instructions,
              tools: form.tools
                .split(/[,\n]/)
                .map((t) => t.trim())
                .filter(Boolean),
            };
            await http(skill ? `/skills/${skill.id}` : '/skills', skill ? 'PUT' : 'POST', body);
            onSaved();
            onClose();
          })
        }
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome"
            size="small"
            {...field('name')}
            slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
          />
          <TextField
            label="Descrição"
            size="small"
            {...field('description')}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="Instruções"
            multiline
            minRows={8}
            {...field('instructions')}
            slotProps={{ htmlInput: { maxLength: 20000 } }}
            sx={{ '& textarea': { fontFamily: 'monospace' } }}
          />
          <TextField
            label="Ferramentas"
            size="small"
            placeholder="reply_conversation, conversation_*"
            {...field('tools')}
          />
        </Stack>
      </ActionDialog>
    </C3Provider>
  );
}
