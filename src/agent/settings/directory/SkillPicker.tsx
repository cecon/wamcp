import { useRef, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { FileUp, Plus } from 'lucide-react';

import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import { useAction } from '../useAction';

interface Props {
  library: Skill[];
  selected: number[];
  onToggle: (id: number) => void;
  /** A skill created or imported here: added to the library and linked to the agent. */
  onCreated: (skill: Skill) => void;
}

/** Links skills to an agent, creating a new one or importing a SKILL.md without leaving the form. */
export function SkillPicker({ library, selected, onToggle, onCreated }: Props) {
  const [draft, setDraft] = useState<{ name: string; instructions: string; tools: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { error, busy, run } = useAction();
  const create = (body: object, path = '/skills') =>
    run(async () => {
      onCreated(await http<Skill>(path, 'POST', body));
      setDraft(null);
    });

  return (
    <Box
      component="fieldset"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, border: 0, m: 0, p: 0 }}
    >
      <Typography component="legend" variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
        Skills
      </Typography>
      {library.length === 0 && !draft && (
        <Typography variant="body2">Nenhuma skill ainda: crie uma aqui ou importe um SKILL.md.</Typography>
      )}
      {library.map((s) => (
        <Box
          key={s.id}
          component="label"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            fontSize: 14,
            color: 'var(--color-n-slate-12)',
          }}
        >
          <Checkbox
            size="small"
            checked={selected.includes(s.id)}
            onChange={() => onToggle(s.id)}
            sx={{ p: 0.5 }}
          />
          {s.name}
          {s.description && (
            <Typography component="span" variant="caption" color="text.secondary">
              — {s.description}
            </Typography>
          )}
        </Box>
      ))}
      {draft ? (
        <Box
          aria-label="Nova skill"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            p: 1.5,
          }}
        >
          <TextField
            size="small"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Nome da skill"
            slotProps={{ htmlInput: { maxLength: 80, 'aria-label': 'Nome da nova skill' } }}
          />
          <TextField
            multiline
            minRows={3}
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            placeholder="Instruções: como o agente deve executar"
            slotProps={{ htmlInput: { 'aria-label': 'Instruções da nova skill' } }}
          />
          <TextField
            size="small"
            value={draft.tools}
            onChange={(e) => setDraft({ ...draft, tools: e.target.value })}
            placeholder="Ferramentas (ex.: reply_conversation, conversation_*)"
            slotProps={{ htmlInput: { 'aria-label': 'Ferramentas da nova skill' } }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              disabled={busy || !draft.name.trim()}
              onClick={() =>
                void create({
                  name: draft.name.trim(),
                  instructions: draft.instructions,
                  tools: draft.tools
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            >
              Criar e vincular
            </Button>
            <Button size="small" variant="outlined" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </Stack>
        </Box>
      ) : (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() => setDraft({ name: '', instructions: '', tools: '' })}
          >
            Nova skill
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileUp size={16} />}
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            Importar SKILL.md
          </Button>
        </Stack>
      )}
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        aria-label="Importar SKILL.md para este agente"
        style={{ display: 'none' }}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (chosen) void chosen.text().then((content) => create({ content }, '/skills/import'));
        }}
      />
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
