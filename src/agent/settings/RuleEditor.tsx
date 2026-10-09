import { useState } from 'react';
import type { Action, Catalog, Condition } from '../types';
import { AUTOMATION_EVENTS } from '../labels';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import { ModalFooter } from '../ui/Settings';
import { ActionsEditor } from './ActionsEditor';
import { ConditionsEditor } from './ConditionsEditor';
import { newAction, newCondition } from './ruleOptions';

export interface RuleDraft {
  name: string;
  event_name: string;
  conditions: Condition[];
  actions: Action[];
}

interface Props {
  catalog: Catalog;
  busy: boolean;
  error: string;
  onSave: (rule: RuleDraft) => void;
  onCancel: () => void;
}

/** Chatwoot automation form: name, event, conditions box and actions box (ConditionRow / ActionInput). */
export function RuleEditor({ catalog, busy, error, onSave, onCancel }: Props) {
  const [rule, setRule] = useState<RuleDraft>({
    name: '',
    event_name: 'message_created',
    conditions: [newCondition()],
    actions: [newAction()],
  });
  const { definitions } = useAttributeDefinitions('conversation');

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rule);
      }}
    >
      <label>
        <span className="field-label">Nome da regra</span>
        <input
          className="field"
          value={rule.name}
          maxLength={120}
          required
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
        />
      </label>
      <label>
        <span className="field-label">Evento</span>
        <select
          className="field"
          value={rule.event_name}
          onChange={(e) => setRule({ ...rule, event_name: e.target.value })}
        >
          {Object.entries(AUTOMATION_EVENTS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <ConditionsEditor
        conditions={rule.conditions}
        catalog={catalog}
        definitions={definitions}
        onChange={(conditions) => setRule((r) => ({ ...r, conditions }))}
      />
      <ActionsEditor
        actions={rule.actions}
        catalog={catalog}
        onChange={(actions) => setRule((r) => ({ ...r, actions }))}
      />
      <ModalFooter busy={busy} submit="Criar automação" onCancel={onCancel} error={error} />
    </form>
  );
}
