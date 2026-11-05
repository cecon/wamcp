import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { Catalog, Inbox, User } from '../types';
import type { Route } from '../route';
import { Avatar } from '../ui/Avatar';
import { InboxAutomation } from './InboxAutomation';
import { InboxLimit } from './InboxLimit';
import { InboxAgentSelect } from './InboxAgentSelect';
import { useAction } from './useAction';
import { GithubSetup } from './github/GithubSetup';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';
import { channelLine } from './channelLine';

const TABS = [
  ['settings', 'Configurações'],
  ['collaborators', 'Colaboradores'],
  ['hours', 'Horário e mensagens'],
] as const;

interface Props {
  inbox: Inbox;
  catalog: Catalog;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Box sx={{ py: 1.5 }}>
      <FormControlLabel
        control={<Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />}
        label={label}
      />
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

/** Settings of one inbox: name, switches, AI agent, limit, collaborators and working hours. */
export function InboxDetail({ inbox, catalog, onNavigate, onChange }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('settings'),
    [name, setName] = useState(inbox.name),
    [members, setMembers] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/inboxes/${inbox.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [inbox.id]);
  const patch = (fields: Record<string, unknown>) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}`, 'PATCH', fields);
      await onChange();
    });
  const toggleMember = (id: number) =>
    run(async () => {
      const add = !members.includes(id);
      const list = await http<User[]>(`/inboxes/${inbox.id}/members`, add ? 'POST' : 'DELETE', {
        user_ids: [id],
      });
      setMembers(list.map((u) => u.id));
      await onChange();
    });

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title={inbox.name}
        description={channelLine(inbox)}
        action={
          <Button variant="text" onClick={() => onNavigate({ page: 'settings', section: 'inboxes' })}>
            Canais
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={(_event, value: (typeof TABS)[number][0]) => setTab(value)}
        aria-label="Caixa de entrada"
      >
        {TABS.map(([id, label]) => (
          <Tab key={id} value={id} label={label} />
        ))}
      </Tabs>
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      {tab === 'settings' && (
        <Stack spacing={2} sx={{ maxWidth: 640 }}>
          {inbox.channel_type === 'github' && <GithubSetup inboxId={inbox.id} />}
          <Stack
            component="form"
            direction="row"
            spacing={1}
            sx={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ name });
            }}
          >
            <TextField
              label="Nome da caixa"
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="contained" disabled={busy || name === inbox.name}>
              Renomear
            </Button>
          </Stack>
          <Stack divider={<Divider />}>
            <SwitchRow
              label="Atribuição automática"
              hint="Distribui novas conversas em rodízio entre agentes online."
              checked={Boolean(inbox.enable_auto_assignment)}
              onChange={(v) => void patch({ enable_auto_assignment: v })}
            />
            <SwitchRow
              label="Uma conversa por contato"
              hint="Mensagem nova reabre a conversa resolvida em vez de criar outra."
              checked={Boolean(inbox.lock_to_single_conversation)}
              onChange={(v) => void patch({ lock_to_single_conversation: v })}
            />
            {inbox.channel_type !== 'github' && (
              <>
                <SwitchRow
                  label="Mostrar o nome do agente"
                  hint="O cliente vê no WhatsApp quem respondeu, em negrito na primeira linha (ex.: *Maria*:)."
                  checked={inbox.show_agent_name !== 0}
                  onChange={(v) => void patch({ show_agent_name: v })}
                />
                <SwitchRow
                  label="Ignorar grupos"
                  hint="Grupos do WhatsApp não viram conversas."
                  checked={Boolean(inbox.ignore_groups)}
                  onChange={(v) => void patch({ ignore_groups: v })}
                />
              </>
            )}
            <SwitchRow
              label="Atendimento por IA (MCP)"
              hint="Conversas novas ficam pendentes para a IA até ela transferir para humanos."
              checked={Boolean(inbox.agent_bot_enabled)}
              onChange={(v) => void patch({ agent_bot_enabled: v })}
            />
          </Stack>
          <InboxAgentSelect inbox={inbox} onChange={onChange} />
          <InboxLimit key={inbox.max_assignment_limit ?? 0} inbox={inbox} busy={busy} onSave={patch} />
        </Stack>
      )}
      {tab === 'collaborators' && (
        <Stack component="ul" divider={<Divider />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {catalog.agents
            .filter((a) => a.active)
            .map((a) => (
              <Stack
                component="li"
                key={a.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', py: 1.5 }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Avatar name={a.name} size={32} status={a.availability} />
                  <Typography variant="body2">
                    {a.name}
                    {a.role === 'administrator' && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {' '}
                        · admin vê todas
                      </Typography>
                    )}
                  </Typography>
                </Stack>
                <FormControlLabel
                  control={
                    <Switch checked={members.includes(a.id)} onChange={() => void toggleMember(a.id)} />
                  }
                  label={`Acesso ${a.name}`}
                />
              </Stack>
            ))}
        </Stack>
      )}
      {tab === 'hours' && (
        <Box sx={{ maxWidth: 640 }}>
          <InboxAutomation inbox={inbox} onChange={onChange} />
        </Box>
      )}
    </SettingsC3Page>
  );
}
