// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Bot, UserRound, Wrench } from 'lucide-react';

import type { RosterAgent, Salary, Skill } from '../../adminTypes';
import { RowActions } from '../../ui/Settings';
import { phone, roleLabel, runtimeLabel } from '../directory/labels';
import { MemberAvatar } from './MemberAvatar';
import { salaryLabel, skillIdsOf, statusOf } from './format';

const TONE = {
  online: 'var(--color-n-teal-9)',
  busy: 'var(--color-n-amber-9)',
  offline: 'var(--color-n-slate-8)',
};

interface Props {
  agent: RosterAgent;
  skills: Skill[];
  salary: Salary | undefined;
  you: boolean;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

/** A member of the organization: who it is, its role, kind, status, monthly cost and skills. */
export function MemberCard({ agent, skills, salary, you, selected, onOpen, onEdit, onDelete }: Props) {
  const status = statusOf(agent);
  const own = skillIdsOf(agent)
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is Skill => Boolean(s));
  const tools = new Set(own.flatMap((s) => s.tools)).size;
  const contact = agent.system
    ? 'Fale com ele pelo WhatsApp do seu cadastro'
    : agent.kind === 'human'
      ? [agent.user_email, phone(agent.whatsapp_jid)].filter(Boolean).join(' · ')
      : [runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ');
  return (
    <Box
      component="article"
      aria-label={agent.name}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        borderRadius: 3,
        bgcolor: 'var(--color-n-solid-2)',
        p: 2,
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        opacity: agent.active ? 1 : 0.6,
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: selected ? 'primary.main' : 'var(--color-n-slate-6)' },
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={48} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <ButtonBase
            onClick={onOpen}
            aria-label={`Abrir ${agent.name}`}
            sx={{ display: 'block', maxWidth: '100%', justifySelf: 'flex-start', textAlign: 'start' }}
          >
            <Typography
              component="span"
              variant="body1"
              sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {agent.name}
              {you && (
                <Box component="span" sx={{ color: 'var(--color-n-slate-10)' }}>
                  {' '}
                  (você)
                </Box>
              )}
            </Typography>
          </ButtonBase>
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            {agent.profile_name ?? '—'}
          </Typography>
          {agent.role && roleLabel(agent.role) !== agent.profile_name && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {roleLabel(agent.role)}
            </Typography>
          )}
        </Box>
        <RowActions labelFor={agent.name} onEdit={onEdit} onDelete={onDelete} />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            borderRadius: 1,
            px: 0.75,
            py: 0.25,
            bgcolor:
              agent.kind === 'ai'
                ? 'color-mix(in srgb, var(--color-n-iris-9) 15%, transparent)'
                : 'var(--color-n-slate-4)',
            color: 'var(--color-n-slate-12)',
          }}
        >
          {agent.kind === 'ai' ? <Bot size={12} /> : <UserRound size={12} />}
          {agent.system ? 'Sistema' : agent.kind === 'ai' ? 'IA' : 'Pessoa'}
        </Box>
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'var(--color-n-slate-11)' }}
        >
          <Box
            component="span"
            aria-hidden
            sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TONE[status.tone] }}
          />
          {status.label}
        </Box>
        <Box
          component="span"
          title="Salário digital"
          sx={{ ml: 'auto', fontWeight: 500, color: 'var(--color-n-slate-12)' }}
        >
          {salaryLabel(agent, salary)}
        </Box>
      </Stack>
      {contact && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: 'block', wordBreak: 'break-all' }}
        >
          {contact}
        </Typography>
      )}
      {(own.length > 0 || agent.credential_count > 0) && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          {own.slice(0, 3).map((s) => (
            <Box
              key={s.id}
              component="span"
              sx={{
                borderRadius: 1,
                bgcolor: 'var(--color-n-alpha-2)',
                px: 0.75,
                py: 0.25,
                color: 'var(--color-n-slate-11)',
              }}
            >
              {s.name}
            </Box>
          ))}
          {own.length > 3 && (
            <Typography component="span" variant="caption" color="text.secondary">
              +{own.length - 3}
            </Typography>
          )}
          {tools > 0 && (
            <Box
              component="span"
              title="Ferramentas"
              sx={{
                ml: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                color: 'var(--color-n-slate-10)',
              }}
            >
              <Wrench size={12} /> {tools}
            </Box>
          )}
          {agent.credential_count > 0 && (
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', width: '100%' }}
            >
              {agent.credential_count} credencia{agent.credential_count === 1 ? 'l' : 'is'}
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}
