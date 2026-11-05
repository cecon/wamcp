import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../../api';
import type { CustomRole, Permission, Skill } from '../../adminTypes';
import { PERMISSIONS } from '../../permissions';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import { executes, ROLES } from '../directory/labels';
import { SkillPicker } from '../directory/SkillPicker';

interface Props {
  role: CustomRole | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Profile form: name, description, role, the skills its agents inherit and the permission checkboxes. */
export function CustomRoleModal({ role, onClose, onSaved }: Props) {
  const [name, setName] = useState(role?.name || ''),
    [description, setDescription] = useState(role?.description || ''),
    [permissions, setPermissions] = useState<Permission[]>(role?.permissions || []),
    [agentRole, setAgentRole] = useState<string>(role?.agent_role || ''),
    [skillIds, setSkillIds] = useState<number[]>(role?.skill_ids || []),
    [created, setCreated] = useState<Skill[]>([]);
  const { data: skills } = useFetch<Skill[]>('/skills');
  const library = [...(skills || []), ...created.filter((c) => !skills?.some((s) => s.id === c.id))];
  const withSkills = executes(agentRole || null);
  const { error, busy, run } = useAction();
  const toggle = (key: Permission) =>
    setPermissions((list) => (list.includes(key) ? list.filter((p) => p !== key) : [...list, key]));

  return (
    <ActionDialog
      open
      title={role ? 'Editar perfil' : 'Adicionar perfil'}
      description="Todo agente, pessoa ou IA, tem um perfil. Ele define as permissões e a função: coordenador, operador, suporte dev ou QA. Agentes de IA precisam de um perfil com função."
      confirmLabel={role ? 'Atualizar perfil' : 'Criar perfil'}
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          const body = {
            name: name.trim(),
            description: description.trim() || null,
            permissions,
            agent_role: agentRole || null,
            skill_ids: withSkills ? skillIds : [],
          };
          await http(role ? `/custom_roles/${role.id}` : '/custom_roles', role ? 'PUT' : 'POST', body);
          onSaved();
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Nome do perfil"
          size="small"
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { required: true, maxLength: 60 } }}
        />
        <TextField
          label="Descrição"
          size="small"
          multiline
          minRows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
        <SelectField
          native
          size="small"
          label="Função"
          value={agentRole}
          onChange={(value) => setAgentRole(value ?? '')}
          emptyLabel="Nenhuma"
          options={ROLES.map((r) => ({ value: r.value, label: `${r.label} — ${r.hint}` }))}
        />
        {withSkills && (
          <Box>
            <SkillPicker
              library={library}
              selected={skillIds}
              onToggle={(id) =>
                setSkillIds((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]))
              }
              onCreated={(skill) => {
                setCreated((list) => [...list, skill]);
                setSkillIds((list) => [...list, skill.id]);
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Todo agente deste perfil, pessoa ou IA, herda estas skills, somadas às dele.
            </Typography>
          </Box>
        )}
        <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
          <Typography component="legend" variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
            Permissões
          </Typography>
          <Stack spacing={1}>
            {PERMISSIONS.map(({ key, label }) => (
              <FormControlLabel
                key={key}
                control={
                  <Checkbox size="small" checked={permissions.includes(key)} onChange={() => toggle(key)} />
                }
                label={<Typography variant="body2">{label}</Typography>}
              />
            ))}
          </Stack>
        </Box>
      </Stack>
    </ActionDialog>
  );
}
