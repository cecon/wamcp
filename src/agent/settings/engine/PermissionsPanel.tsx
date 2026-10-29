import { useState } from 'react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { SidePanel } from '../../ui/Overlay';
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
    <SidePanel title="Permissões dos agentes de IA" onClose={onClose}>
      <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5 text-sm">
        <label>
          <span className="field-label">Agente</span>
          <select className="field" value={agentId} onChange={(e) => setAgentId(Number(e.target.value))}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {catalog.data && (
          <p className="text-xs text-n-slate-11">
            Runtimes:{' '}
            {catalog.data.runtimes
              .map((r) => `${r.id} ${r.available ? '(instalado)' : `(indisponível: ${r.detail})`}`)
              .join(' · ')}
          </p>
        )}
        {policy && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-medium text-n-slate-12">Autonomia e limites</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policy.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              Motor ligado para este agente
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policy.proactive_enabled}
                onChange={(e) => set('proactive_enabled', e.target.checked)}
              />
              Pode agir por iniciativa própria (por eventos)
            </label>
            <label>
              <span className="field-label">Política de execução</span>
              <select
                className="field"
                value={policy.execution_policy}
                onChange={(e) => set('execution_policy', e.target.value as ExecutionPolicy)}
              >
                {Object.entries(POLICY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label>
                <span className="field-label">Execuções simultâneas</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="field"
                  value={policy.max_concurrency}
                  onChange={(e) => set('max_concurrency', Number(e.target.value))}
                />
              </label>
              <label>
                <span className="field-label">Tempo máximo (s)</span>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  className="field"
                  value={policy.run_timeout_secs}
                  onChange={(e) => set('run_timeout_secs', Number(e.target.value))}
                />
              </label>
              <label>
                <span className="field-label">Tokens por mês</span>
                <input
                  type="number"
                  min={0}
                  className="field"
                  placeholder="Sem limite"
                  value={policy.monthly_token_budget ?? ''}
                  onChange={(e) =>
                    set('monthly_token_budget', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </label>
            </div>
            <Button label="Salvar limites" disabled={action.busy} onClick={save} className="self-start" />
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-n-slate-12">Ferramentas</legend>
          {coordinator && (
            <p className="text-xs text-n-slate-11">
              Coordenadores não executam ferramentas: eles só delegam.
            </p>
          )}
          {tools.map((tool) => {
            const effect = current.data?.grants.find((g) => g.tool === tool.name)?.effect ?? '';
            return (
              <label key={tool.name} className="flex items-center justify-between gap-3">
                <span>
                  <code className="text-xs">{tool.name}</code>
                  <span className="block text-xs text-n-slate-11">{tool.description}</span>
                </span>
                <select
                  className="field !w-44"
                  aria-label={`Permissão para ${tool.name}`}
                  value={effect}
                  disabled={coordinator || action.busy}
                  onChange={(e) => grant(tool.name, e.target.value)}
                >
                  <option value="">Negada</option>
                  <option value="allow">Permitida</option>
                  <option value="approval">Com aprovação</option>
                </select>
              </label>
            );
          })}
        </fieldset>
        {(action.error || current.error) && (
          <p role="alert" className="text-n-ruby-11">
            {action.error || current.error}
          </p>
        )}
      </div>
    </SidePanel>
  );
}
