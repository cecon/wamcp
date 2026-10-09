import { useState } from 'react';
import { http } from '../api';
import type { SlaPolicy } from '../parityTypes';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';
import {
  splitThreshold,
  THRESHOLDS,
  toSeconds,
  UNIT_LABEL,
  type ThresholdKey,
  type ThresholdUnit,
} from '../sla/sla';
import { useAction } from './useAction';

type Targets = Record<ThresholdKey, { value: string; unit: ThresholdUnit }>;

interface Props {
  policy: SlaPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Chatwoot SLA form: name, description and the three targets in minutes, hours or days. */
export function SlaModal({ policy, onClose, onSaved }: Props) {
  const [name, setName] = useState(policy?.name || ''),
    [description, setDescription] = useState(policy?.description || ''),
    [targets, setTargets] = useState<Targets>(
      () =>
        Object.fromEntries(
          THRESHOLDS.map(({ key }) => [key, splitThreshold(policy?.[key] ?? null)]),
        ) as Targets,
    );
  const { error, busy, run } = useAction();
  const setTarget = (key: ThresholdKey, patch: Partial<Targets[ThresholdKey]>) =>
    setTargets((t) => ({ ...t, [key]: { ...t[key], ...patch } }));

  return (
    <Modal
      title={policy ? 'Editar SLA' : 'Adicionar SLA'}
      description="Defina ao menos um prazo. Os prazos contam a partir da aplicação do SLA na conversa."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = {
              name: name.trim(),
              description: description.trim() || null,
              ...Object.fromEntries(
                THRESHOLDS.map(({ key }) => [key, toSeconds(targets[key].value, targets[key].unit)]),
              ),
            };
            await http(
              policy ? `/sla_policies/${policy.id}` : '/sla_policies',
              policy ? 'PUT' : 'POST',
              body,
            );
            onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome</span>
          <input
            className="field"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <input
            className="field"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {THRESHOLDS.map(({ key, label }) => (
          <fieldset key={key} className="flex items-end gap-2">
            <label className="flex-1">
              <span className="field-label">{label}</span>
              <input
                className="field"
                type="number"
                min={1}
                step="any"
                placeholder="Sem prazo"
                value={targets[key].value}
                onChange={(e) => setTarget(key, { value: e.target.value })}
              />
            </label>
            <select
              aria-label={`Unidade ${label}`}
              className="field !w-32"
              value={targets[key].unit}
              onChange={(e) => setTarget(key, { unit: e.target.value as ThresholdUnit })}
            >
              {Object.entries(UNIT_LABEL).map(([unit, unitLabel]) => (
                <option key={unit} value={unit}>
                  {unitLabel}
                </option>
              ))}
            </select>
          </fieldset>
        ))}
        <ModalFooter busy={busy} submit="Salvar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
