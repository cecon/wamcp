import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { Plus, Settings, UsersRound } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { Catalog, Team, User } from '../types';
import type { Route } from '../route';
import { Avatar } from '../ui/Avatar';
import { Toggle } from '../ui/Settings';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

interface Props {
  catalog: Catalog;
  teamId?: number;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

/** Times no C3Theme (lote 30): lista, “criar novo time” e a página do time com membros. */
export function TeamsPage({ catalog, teamId, onNavigate, onChange }: Props) {
  const [creating, setCreating] = useState(false);
  const team = teamId ? catalog.teams.find((t) => t.id === teamId) : undefined;
  if (team) return <TeamDetail team={team} catalog={catalog} onNavigate={onNavigate} onChange={onChange} />;
  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Times"
        description="Times agrupam agentes por responsabilidade. Uma conversa direcionada ao time pode ser atribuída a um membro online."
        count={`${catalog.teams.length} time${catalog.teams.length === 1 ? '' : 's'}`}
        action={
          <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Criar novo time
          </Button>
        }
      />
      <Box component="ul" sx={{ borderTop: 1, borderColor: 'divider', listStyle: 'none', m: 0, p: 0 }}>
        {catalog.teams.length === 0 && (
          <Box component="li" sx={{ py: 10, textAlign: 'center' }}>
            <Typography variant="body1">Nenhum time ainda.</Typography>
          </Box>
        )}
        {catalog.teams.map((t) => (
          <Stack
            component="li"
            key={t.id}
            direction="row"
            spacing={2}
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              py: 2,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" spacing={2} sx={{ minWidth: 0, alignItems: 'center' }}>
              <Box
                sx={{
                  display: 'flex',
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 2,
                  color: 'text.disabled',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <UsersRound size={20} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" component="p" noWrap>
                  {t.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {t.description || 'Sem descrição'} · {t.member_count ?? 0} membro(s)
                </Typography>
              </Box>
            </Stack>
            <IconButton
              aria-label={`Configurar ${t.name}`}
              onClick={() => onNavigate({ page: 'settings', section: 'teams', id: t.id })}
            >
              <Settings size={16} />
            </IconButton>
          </Stack>
        ))}
      </Box>
      {creating && <TeamModal onClose={() => setCreating(false)} onSaved={onChange} />}
    </SettingsC3Page>
  );
}

function TeamModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const { error, busy, run } = useAction();
  return (
    <ActionDialog
      open
      title="Criar novo time"
      confirmLabel="Criar time"
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          await http('/teams', 'POST', { name: form.name, description: form.description || null });
          await onSaved();
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Nome do time"
          size="small"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
        />
        <TextField
          label="Descrição"
          multiline
          minRows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </Stack>
    </ActionDialog>
  );
}

interface DetailProps {
  team: Team;
  catalog: Catalog;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

function TeamDetail({ team, catalog, onNavigate, onChange }: DetailProps) {
  const [members, setMembers] = useState<number[]>([]);
  const { error, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/teams/${team.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [team.id]);
  const back = () => onNavigate({ page: 'settings', section: 'teams' });
  const toggle = (id: number) =>
    run(async () => {
      const add = !members.includes(id);
      const list = await http<User[]>(`/teams/${team.id}/members`, add ? 'POST' : 'DELETE', {
        user_ids: [id],
      });
      setMembers(list.map((u) => u.id));
      await onChange();
    });
  return (
    <SettingsC3Page>
      <SettingsC3Header title={team.name} description={team.description || undefined} />
      <Button variant="text" onClick={back} sx={{ alignSelf: 'flex-start' }}>
        ← Times
      </Button>
      <Box sx={{ borderRadius: 2, px: 2, border: 1, borderColor: 'divider' }}>
        <Toggle
          label="Atribuição automática no time"
          hint="Ao direcionar uma conversa ao time, um membro online a recebe em rodízio."
          checked={Boolean(team.allow_auto_assign)}
          onChange={(allow) =>
            void run(async () => {
              await http(`/teams/${team.id}`, 'PATCH', { allow_auto_assign: allow });
              await onChange();
            })
          }
        />
      </Box>
      <Typography variant="h6" component="h2" sx={{ mt: 1 }}>
        Membros
      </Typography>
      <Box component="ul" sx={{ borderTop: 1, borderColor: 'divider', listStyle: 'none', m: 0, p: 0 }}>
        {catalog.agents
          .filter((a) => a.active)
          .map((a) => (
            <Stack
              component="li"
              key={a.id}
              direction="row"
              spacing={2}
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Avatar name={a.name} size={32} status={a.availability} />
                <Typography variant="body2">{a.name}</Typography>
              </Stack>
              <Toggle
                compact
                label={`Membro ${a.name}`}
                checked={members.includes(a.id)}
                onChange={() => void toggle(a.id)}
              />
            </Stack>
          ))}
      </Box>
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Button
        color="error"
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() =>
          void run(async () => {
            if (!window.confirm(`Excluir o time ${team.name}?`)) return;
            await http(`/teams/${team.id}`, 'DELETE');
            await onChange();
            back();
          })
        }
      >
        Excluir time
      </Button>
    </SettingsC3Page>
  );
}
