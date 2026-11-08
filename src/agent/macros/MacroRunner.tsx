import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Play } from 'lucide-react';

import { http } from '../api';
import type { Macro } from '../accountTypes';
import type { Conversation } from '../types';
import { executeMacro, useMacros, VISIBILITY_LABEL } from './useMacros';

interface Props {
  conversation: Conversation;
  onChange: (conversation: Conversation) => void;
}

/** Chatwoot conversation sidebar "Macros": run one on this conversation and show the outcome. */
export function MacroRunner({ conversation, onChange }: Props) {
  const { macros, loaded, error } = useMacros();
  const [running, setRunning] = useState<number | null>(null),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(macro: Macro) {
    setRunning(macro.id);
    setResult(null);
    try {
      const outcome = await executeMacro(macro, [conversation.display_id]);
      const failure = outcome.failed[0];
      setResult(
        failure
          ? { ok: false, text: `Falha ao executar “${macro.name}”: ${failure.error}` }
          : { ok: true, text: `Macro “${macro.name}” executada com sucesso.` },
      );
      onChange(await http<Conversation>(`/conversations/${conversation.display_id}`));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setRunning(null);
    }
  }

  if (error)
    return (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    );
  if (loaded && macros.length === 0)
    return (
      <Typography variant="body2" color="text.secondary">
        Nenhuma macro disponível. Crie macros em Configurações → Macros.
      </Typography>
    );
  return (
    <Stack spacing={1}>
      <Box
        component="ul"
        aria-label="Macros disponíveis"
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, listStyle: 'none', m: 0, p: 0 }}
      >
        {macros.map((m) => (
          <Box
            component="li"
            key={m.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderRadius: 1,
              px: 1,
              py: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ display: 'block' }}>
                {m.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {VISIBILITY_LABEL[m.visibility]}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label={`Executar ${m.name}`}
              title="Executar"
              disabled={running !== null}
              onClick={() => void run(m)}
            >
              <Play size={14} />
            </IconButton>
          </Box>
        ))}
      </Box>
      {result && (
        <Typography
          variant="body2"
          role={result.ok ? 'status' : 'alert'}
          sx={{ color: result.ok ? 'success.main' : 'error.main' }}
        >
          {result.text}
        </Typography>
      )}
    </Stack>
  );
}
