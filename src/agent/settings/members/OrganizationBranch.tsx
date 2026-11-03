// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Bot, Inbox as InboxIcon, UserRound } from 'lucide-react';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import type { Catalog } from '../../types';
import { useAction } from '../useAction';
import { roleLabel } from '../directory/labels';
import { MemberAvatar } from './MemberAvatar';
import { agentBody } from './format';

export interface BranchProps {
  nodes: RosterAgent[];
  below: (id: number | null) => RosterAgent[];
  roster: RosterAgent[];
  inboxes: Catalog['inboxes'];
  onChanged: () => void;
  depth?: number;
}

/** The organogram itself: each member answers to the one above, and the tree keeps the hierarchy visible. */
export function Branch({ nodes, below, roster, inboxes, onChanged, depth = 0 }: BranchProps) {
  return (
    <Box
      component="ul"
      role={depth ? 'group' : 'tree'}
      aria-label={depth ? undefined : 'Organograma'}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, m: 0, p: 0, listStyle: 'none' }}
    >
      {nodes.map((agent) => {
        const children = depth < 20 ? below(agent.id) : [];
        return (
          <Box
            key={agent.id}
            component="li"
            role="treeitem"
            aria-label={agent.name}
            aria-expanded={children.length > 0 || undefined}
            sx={{ listStyle: 'none' }}
          >
            <Node agent={agent} roster={roster} inboxes={inboxes} onChanged={onChanged} />
            {children.length > 0 && (
              <Box
                sx={{
                  ml: 3,
                  mt: 1,
                  borderLeft: 2,
                  borderColor: 'divider',
                  pl: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Branch
                  nodes={children}
                  below={below}
                  roster={roster}
                  inboxes={inboxes}
                  onChanged={onChanged}
                  depth={depth + 1}
                />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function Node({
  agent,
  roster,
  inboxes,
  onChanged,
}: {
  agent: RosterAgent;
  roster: RosterAgent[];
  inboxes: Catalog['inboxes'];
  onChanged: () => void;
}) {
  const { error, busy, run } = useAction();
  const serves = inboxes.filter((i) => i.ai_agent_id === agent.id);
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        flexWrap: 'wrap',
        alignItems: 'center',
        borderRadius: 3,
        bgcolor: 'var(--color-n-solid-2)',
        px: 1.5,
        py: 1,
        border: 1,
        borderColor: 'divider',
        opacity: agent.active ? 1 : 0.6,
      }}
    >
      <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={36} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="span" variant="body2" sx={{ display: 'block', fontWeight: 500 }} noWrap>
          {agent.name}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', alignItems: 'center', color: 'var(--color-n-slate-11)', fontSize: 12 }}
        >
          <Box
            component={agent.kind === 'ai' ? Bot : UserRound}
            size={12}
            aria-hidden
            sx={{ flexShrink: 0 }}
          />
          {agent.role ? roleLabel(agent.role) : 'Sem função'}
          {serves.map((i) => (
            <Box
              key={i.id}
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                borderRadius: 0.5,
                bgcolor: 'var(--color-n-alpha-2)',
                px: 0.5,
              }}
            >
              <Box component={InboxIcon} size={11} aria-hidden /> {i.name}
            </Box>
          ))}
        </Stack>
        {error && (
          <Typography
            component="span"
            variant="caption"
            sx={{ display: 'block', color: 'var(--color-n-ruby-11)' }}
          >
            {error}
          </Typography>
        )}
      </Box>
      <Box
        component="label"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12, color: 'var(--color-n-slate-11)' }}
      >
        Responde a
        <Box
          component="select"
          aria-label={`${agent.name} responde a`}
          disabled={busy}
          value={agent.supervisor_id ? String(agent.supervisor_id) : ''}
          onChange={(e) =>
            void run(async () => {
              const supervisor_id = e.target.value ? Number(e.target.value) : null;
              await http(`/agent_directory/${agent.id}`, 'PUT', agentBody(agent, { supervisor_id }));
              onChanged();
            })
          }
          sx={{
            height: 32,
            width: 176,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            color: 'text.primary',
            px: 1,
          }}
        >
          <option value="">Ninguém (topo)</option>
          {roster
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Box>
      </Box>
    </Stack>
  );
}
