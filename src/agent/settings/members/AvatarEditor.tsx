import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { AvatarChoices, RosterAgent } from '../../adminTypes';
import { useAction } from '../useAction';
import { AVATAR_PARTS, CHOICE_LABELS, PART_LABELS, withDefaults, type AvatarPart } from './avatar';
import { MemberAvatar } from './MemberAvatar';

/** "Personalização": hair, clothes, accessory, skin and color of the member's avatar. */
export function AvatarEditor({ agent, onSaved }: { agent: RosterAgent; onSaved: () => void }) {
  const [choices, setChoices] = useState<AvatarChoices>(withDefaults(agent.avatar, agent.kind, agent.id));
  const { error, busy, run } = useAction();
  const parts = Object.keys(AVATAR_PARTS) as AvatarPart[];
  return (
    <Box
      component="section"
      aria-label="Personalização"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Typography variant="h6" component="h3">
        Personalização
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <MemberAvatar
          choices={choices}
          kind={agent.kind}
          seed={agent.id}
          size={88}
          title="Prévia do avatar"
        />
        <Box
          sx={{
            display: 'grid',
            flex: 1,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
          }}
        >
          {parts.map((part) => (
            <Box key={part} component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="body2">{PART_LABELS[part]}</Typography>
              <Box
                component="select"
                value={choices[part]}
                onChange={(e) => setChoices({ ...choices, [part]: e.target.value })}
                sx={{
                  height: 32,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  px: 1,
                }}
              >
                {AVATAR_PARTS[part].map((choice) => (
                  <option key={choice} value={choice}>
                    {CHOICE_LABELS[choice]}
                  </option>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        variant="contained"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await http(`/agent_directory/${agent.id}/avatar`, 'PUT', choices);
            onSaved();
          })
        }
        sx={{ alignSelf: 'flex-end' }}
      >
        Salvar avatar
      </Button>
    </Box>
  );
}
