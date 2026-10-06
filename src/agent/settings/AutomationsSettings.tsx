import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { http } from '../api';
import type { AutomationRule } from '../types';
import { ACTIONS, AUTOMATION_EVENTS } from '../labels';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';
import { RuleEditor } from './RuleEditor';

export function AutomationsSettings({ catalog }: SettingsProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]),
    [editor, setEditor] = useState(0);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<AutomationRule[]>('/automation_rules').then(setRules), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Automações</h2>
        <p className="muted">Regras rodam após cada evento e não disparam a si mesmas.</p>
        <ul className="plain-list">
          {rules.map((r) => (
            <li key={r.id} className="row">
              <span>
                <strong>{r.name}</strong>
                <small>
                  {AUTOMATION_EVENTS[r.event_name]} · {r.conditions.length} condição(ões) ·{' '}
                  {r.actions.map((a) => ACTIONS[a.action_name] || a.action_name).join(', ')}
                </small>
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(r.active)}
                  aria-label={`Ativa ${r.name}`}
                  onChange={(e) =>
                    void run(async () => {
                      await http(`/automation_rules/${r.id}`, 'PATCH', { active: e.target.checked });
                      await load();
                    })
                  }
                />
                ativa
              </label>
              <button
                className="icon-btn"
                aria-label={`Excluir ${r.name}`}
                onClick={() =>
                  void run(async () => {
                    await http(`/automation_rules/${r.id}`, 'DELETE');
                    await load();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        {rules.length === 0 && <p className="muted">Nenhuma automação ainda.</p>}
        {error && <p className="form-error">{error}</p>}
      </section>
      <RuleEditor
        key={editor}
        catalog={catalog}
        busy={busy}
        onSave={(rule) =>
          void run(async () => {
            await http('/automation_rules', 'POST', rule);
            setEditor((n) => n + 1);
            await load();
          })
        }
      />
    </div>
  );
}
