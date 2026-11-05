import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { X } from 'lucide-react';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import {
  POLICY_LABEL,
  type EngineCatalog,
  type EngineGrant,
  type EnginePolicy,
  type ExecutionPolicy,
} from './types';

interface Props {
  agents: RosterAgent[];
  onClose: () => void;
}

type PolicyReply = { policy: EnginePolicy; grants: EngineGrant[] };

/** What each AI agent may do: autonomy, limits and the business tools it is granted (deny by default). */
export function PermissionsPanel({ agents, onClose }: Props) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? 0);
  const catalog = useFetch<EngineCatalog>('/engine/catalog');
  const current = useFetch<PolicyReply>(agentId ? `/engine/agents/${agentId}/policy` : null);
  // Unsaved edits of the selected agent's policy; otherwise what the server has.
  const [edits, setEdits] = useState<{ agent: number; policy: EnginePolicy } | null>(null);
  const policy = edits?.agent === agentId ? edits.policy : (current.data?.policy ?? null);
  const action = useAction();
  const coordinator = agents.find((a) => a.id === agentId)?.role === 'coordinator';

  const grant = (tool: string, effect: string) =>
    void action.run(async () => {
      await http(`/engine/agents/${agentId}/grants`, 'PUT', { tool, effect: effect || null });
      current.reload();
    });

  const save = () =>
    void action.run(async () => {
      await http(`/engine/agents/${agentId}/policy`, 'PUT', policy);
      current.reload();
    });

  const tools = (catalog.data?.tools || []).filter((t) => !t.builtin);
  const set = <K extends keyof EnginePolicy>(key: K, value: EnginePolicy[K]) =>
    policy && setEdits({ agent: agentId, policy: { ...policy, [key]: value } });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose} scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Permissões dos agentes de IA
        <IconButton size="small" aria-label="Fechar" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <TextField
            select
            label="Agente"
            size="small"
            fullWidth
            value={agentId}
            onChange={(e) => setAgentId(Number(e.target.value))}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </TextField>
          {catalog.data && (
            <Typography variant="caption" color="text.secondary">
              Runtimes:{' '}
              {catalog.data.runtimes
                .map((r) => `${r.id} ${r.available ? '(instalado)' : `(indisponível: ${r.detail})`}`)
                .join(' · ')}
            </Typography>
          )}
          {policy && (
            <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
              <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
                Autonomia e limites
              </Typography>
              <Stack spacing={1.5}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={policy.enabled}
                      onChange={(e) => set('enabled', e.target.checked)}
                    />
                  }
                  label="Motor ligado para este agente"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={policy.proactive_enabled}
                      onChange={(e) => set('proactive_enabled', e.target.checked)}
                    />
                  }
                  label="Pode agir por iniciativa própria (por eventos)"
                />
                <TextField
                  select
                  label="Política de execução"
                  size="small"
                  fullWidth
                  value={policy.execution_policy}
                  onChange={(e) => set('execution_policy', e.target.value as ExecutionPolicy)}
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                >
                  {Object.entries(POLICY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </TextField>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    label="Execuções simultâneas"
                    size="small"
                    type="number"
                    value={policy.max_concurrency}
                    onChange={(e) => set('max_concurrency', Number(e.target.value))}
                    slotProps={{ htmlInput: { min: 1, max: 10 } }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Tempo máximo (s)"
                    size="small"
                    type="number"
                    value={policy.run_timeout_secs}
                    onChange={(e) => set('run_timeout_secs', Number(e.target.value))}
                    slotProps={{ htmlInput: { min: 10, max: 3600 } }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Tokens por mês"
                    size="small"
                    type="number"
                    placeholder="Sem limite"
                    value={policy.monthly_token_budget ?? ''}
                    onChange={(e) =>
                      set('monthly_token_budget', e.target.value === '' ? null : Number(e.target.value))
                    }
                    slotProps={{ htmlInput: { min: 0 } }}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                <Button
                  variant="contained"
                  size="small"
                  disabled={action.busy}
                  onClick={save}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Salvar limites
                </Button>
              </Stack>
            </Box>
          )}
          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
              Ferramentas
            </Typography>
            <Stack spacing={1.5}>
              {coordinator && (
                <Typography variant="caption" color="text.secondary">
                  Coordenadores não executam ferramentas: eles só delegam.
                </Typography>
              )}
              {tools.map((tool) => {
                const effect = current.data?.grants.find((g) => g.tool === tool.name)?.effect ?? '';
                return (
                  <Box key={tool.name} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography component="code" variant="caption">
                        {tool.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {tool.description}
                      </Typography>
                    </Box>
                    <TextField
                      select
                      size="small"
                      value={effect}
                      disabled={coordinator || action.busy}
                      onChange={(e) => grant(tool.name, e.target.value)}
                      slotProps={{
                        select: { native: true },
                        inputLabel: { shrink: true },
                        htmlInput: { 'aria-label': `Permissão para ${tool.name}` },
                      }}
                      sx={{ minWidth: 176 }}
                    >
                      <option value="">Negada</option>
                      <option value="allow">Permitida</option>
                      <option value="approval">Com aprovação</option>
                    </TextField>
                  </Box>
                );
              })}
            </Stack>
          </Box>
          {(action.error || current.error) && (
            <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
              {action.error || current.error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
