import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { AutomationRule, Catalog } from '../types';
import { ACTIONS, AUTOMATION_EVENTS } from '../labels';
import { Button } from '../ui/Button';
import { SidePanel } from '../ui/Overlay';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table, Toggle } from '../ui/Settings';
import { RuleEditor } from './RuleEditor';
import { useAction } from './useAction';

/** Chatwoot Automation settings: rules table (Name | Active | Created) and the rule side panel. */
export function AutomationPage({ catalog }: { catalog: Catalog }) {
  const [rules, setRules] = useState<AutomationRule[]>([]),
    [q, setQ] = useState(''),
    [creating, setCreating] = useState(false);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<AutomationRule[]>('/automation_rules').then(setRules), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const visible = rules.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <SettingsPage>
      <SettingsHeader
        title="Automação"
        description="Regras rodam após cada evento e executam ações como atribuir, etiquetar ou responder. Ações feitas por uma regra não disparam outras regras."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar automações…' }}
        count={`${rules.length} regra${rules.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Criar automação" onClick={() => setCreating(true)} />}
      />
      {error && !creating && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table headers={['Nome', 'Quando', 'Ativa', '']} rows={visible.length} empty="Nenhuma automação ainda.">
        {visible.map((r) => (
          <tr key={r.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{r.name}</span>
              <span className="text-sm">
                {r.actions.map((a) => ACTIONS[a.action_name] || a.action_name).join(', ')}
              </span>
            </Cell>
            <Cell>{AUTOMATION_EVENTS[r.event_name]}</Cell>
            <Cell className="w-24">
              <Toggle
                compact
                label={`Ativa ${r.name}`}
                checked={Boolean(r.active)}
                onChange={(active) =>
                  void run(async () => {
                    await http(`/automation_rules/${r.id}`, 'PATCH', { active });
                    await load();
                  })
                }
              />
            </Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={r.name}
                onDelete={() =>
                  void run(async () => {
                    await http(`/automation_rules/${r.id}`, 'DELETE');
                    await load();
                  })
                }
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {creating && (
        <SidePanel title="Criar automação" onClose={() => setCreating(false)}>
          <RuleEditor
            catalog={catalog}
            busy={busy}
            error={error}
            onCancel={() => setCreating(false)}
            onSave={(rule) =>
              void run(async () => {
                await http('/automation_rules', 'POST', rule);
                setCreating(false);
                await load();
              })
            }
          />
        </SidePanel>
      )}
    </SettingsPage>
  );
}
