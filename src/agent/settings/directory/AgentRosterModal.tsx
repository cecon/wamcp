import { useCallback, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../../api';
import type { CustomRole, RosterAgent, RosterKind, Skill } from '../../adminTypes';
import C3Provider from '../../c3/C3Provider';
import { useAction } from '../useAction';
import { CredentialsPanel } from './CredentialsPanel';
import { SkillPicker } from './SkillPicker';
import { AccessSection } from './AccessSection';
import { noAccess } from './access';
import { executes, holdsCredentials, phone, roleLabel, RUNTIMES } from './labels';
import { RuntimeSelect } from './RuntimeSelect';

interface Props {
  agent: RosterAgent | null;
  /** Kind of a new agent (an existing agent keeps its kind). */
  kind: RosterKind;
  skills: Skill[];
  /** Profiles: AI agents pick one with an AI role, people any. */
  profiles: CustomRole[];
  /** Opens the login settings of a person with helpdesk access. */
  onManageAccess: (userId: number) => void;
  onClose: () => void;
  onSaved: () => void;
  /** A skill was created from this form (the page reloads its library). */
  onSkillsChanged: () => void;
}

const SELECT_SX = {
  height: 40,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1,
} as const;

/** Human or AI agent form: role, contact (humans) or runtime and instructions (AI), skills and credentials. */
export function AgentRosterModal(props: Props) {
  const { agent, kind, skills, profiles, onManageAccess, onClose, onSaved, onSkillsChanged } = props;
  const human = (agent?.kind ?? kind) === 'human';
  // People and AI share the roles of the profiles; AI agents need one with a role.
  const choices = human ? profiles : profiles.filter((p) => p.agent_role);
  const initial = human
    ? profiles.find((p) => p.builtin)
    : (choices.find((p) => p.agent_role === 'operator') ?? choices[0]);
  const [form, setForm] = useState({
    name: agent?.name || '',
    profile_id: String(agent?.profile_id ?? initial?.id ?? ''),
    description: agent?.description || '',
    whatsapp: phone(agent?.whatsapp_jid ?? null),
    runtime: agent?.runtime || RUNTIMES[0].value,
    model: agent?.model || '',
    instructions: agent?.instructions || '',
    goals: agent?.goals || '',
    active: agent?.active ?? true,
  });
  const [skillIds, setSkillIds] = useState<number[]>(agent?.skill_ids || []);
  const [library, setLibrary] = useState(skills);
  const [access, setAccess] = useState(noAccess);
  const { error, busy, run } = useAction();
  const setRuntime = useCallback((runtime: string) => setForm((f) => ({ ...f, runtime })), []);
  const chosen = profiles.find((p) => String(p.id) === form.profile_id);
  const withSkills = executes(chosen?.agent_role ?? null);
  const inherited = (chosen?.skill_ids || [])
    .map((id) => library.find((s) => s.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const toggle = (id: number) =>
    setSkillIds((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]));

  const body = (userId: number | null) => {
    const common = {
      name: form.name.trim(),
      kind: human ? 'human' : 'ai',
      profile_id: Number(form.profile_id) || null,
      description: form.description.trim() || null,
      active: form.active,
      // Set in the detail pane or the organization tree; the form keeps it.
      supervisor_id: agent?.supervisor_id ?? null,
    };
    if (human) return { ...common, whatsapp: form.whatsapp.trim() || null, user_id: userId };
    return {
      ...common,
      runtime: form.runtime,
      model: form.model.trim() || null,
      instructions: form.instructions.trim() || null,
      goals: form.goals.trim() || null,
    };
  };

  const save = () =>
    void run(async () => {
      // A new login first: every login is already a person, which this save then completes.
      let userId = agent?.user_id ?? null;
      if (human && !userId && access.enabled) {
        const login = { name: form.name.trim(), email: access.email, password: access.password };
        const created = await http<{ id: number }>('/agents', 'POST', {
          ...login,
          role: access.role,
          inbox_ids: [],
        });
        userId = created.id;
      }
      const saved = await http<RosterAgent>(
        agent ? `/agent_directory/${agent.id}` : '/agent_directory',
        agent ? 'PUT' : 'POST',
        body(userId),
      );
      const same = [...skillIds].sort().join() === [...saved.skill_ids].sort().join();
      if (!same)
        await http(`/agent_directory/${saved.id}/skills`, 'PUT', {
          skill_ids: withSkills ? skillIds : [],
        });
      onSaved();
      onClose();
    });

  return (
    <C3Provider>
      <ActionDialog
        open
        title={agent ? `Editar ${agent.name}` : human ? 'Adicionar pessoa' : 'Adicionar agente de IA'}
        description={
          human
            ? 'Uma pessoa da equipe: com WhatsApp, os agentes de IA podem consultá-la; com acesso ao helpdesk, ela entra e atende conversas.'
            : 'Agentes de IA executados por um runtime agêntico. Coordenadores só delegam; os demais executam com as suas skills.'
        }
        confirmLabel={agent ? 'Atualizar agente' : 'Criar agente'}
        backLabel="Cancelar"
        loading={busy}
        error={error || undefined}
        onClose={onClose}
        onConfirm={save}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome"
            size="small"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
          />
          <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography component="span" variant="body2">
              Perfil
            </Typography>
            <Box
              component="select"
              value={form.profile_id}
              onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
              sx={SELECT_SX}
            >
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.agent_role ? `${p.name} — ${roleLabel(p.agent_role)}` : p.name}
                </option>
              ))}
            </Box>
          </Box>
          <TextField
            label="Descrição"
            size="small"
            multiline
            minRows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {human ? (
            <>
              <TextField
                label="WhatsApp"
                size="small"
                type="tel"
                placeholder="+55 11 98888-7777"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
              <AccessSection agent={agent} access={access} onChange={setAccess} onManage={onManageAccess} />
            </>
          ) : (
            <>
              <RuntimeSelect value={form.runtime} onChange={setRuntime} pickInstalled={!agent} />
              <TextField
                label={form.runtime === 'opencode' ? 'Modelo (provedor/modelo)' : 'Modelo (opcional)'}
                size="small"
                placeholder={
                  form.runtime === 'opencode' ? 'Ex.: openrouter/openai/gpt-5' : 'Padrão do runtime'
                }
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                slotProps={{ htmlInput: { required: form.runtime === 'opencode', maxLength: 80 } }}
              />
              <TextField
                label="Instruções do agente"
                multiline
                minRows={4}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 8000 } }}
              />
              <TextField
                label="Objetivos (quando encerrar a conversa)"
                multiline
                minRows={2}
                placeholder="Ex.: o PR foi mesclado e o CI está verde; ou o cliente confirmou o pedido."
                helperText="O agente marca a conversa como resolvida sozinho quando este critério for atendido."
                value={form.goals}
                onChange={(e) => setForm({ ...form, goals: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
            </>
          )}
          {withSkills && (
            <SkillPicker
              library={library}
              selected={skillIds}
              onToggle={toggle}
              onCreated={(skill) => {
                setLibrary((list) => [...list, skill]);
                setSkillIds((list) => [...list, skill.id]);
                onSkillsChanged();
              }}
            />
          )}
          {withSkills && inherited.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Herdadas do perfil {chosen?.name}: {inherited.join(', ')}.
            </Typography>
          )}
          <Box
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
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              sx={{ p: 0.5 }}
            />
            Ativo
          </Box>
          {agent && holdsCredentials(agent) && <CredentialsPanel agentId={agent.id} onChange={onSaved} />}
        </Stack>
      </ActionDialog>
    </C3Provider>
  );
}
