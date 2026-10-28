import { useState } from 'react';
import { http } from '../../api';
import type { AvatarChoices, RosterAgent } from '../../adminTypes';
import { Button } from '../../ui/Button';
import { useAction } from '../useAction';
import { AVATAR_PARTS, CHOICE_LABELS, PART_LABELS, withDefaults, type AvatarPart } from './avatar';
import { MemberAvatar } from './MemberAvatar';

/** "Personalização": hair, clothes, accessory, skin and color of the member's avatar. */
export function AvatarEditor({ agent, onSaved }: { agent: RosterAgent; onSaved: () => void }) {
  const [choices, setChoices] = useState<AvatarChoices>(withDefaults(agent.avatar, agent.kind, agent.id));
  const { error, busy, run } = useAction();
  const parts = Object.keys(AVATAR_PARTS) as AvatarPart[];
  return (
    <section aria-label="Personalização" className="flex flex-col gap-3">
      <h3 className="text-heading-3 text-n-slate-12">Personalização</h3>
      <div className="flex items-start gap-4">
        <MemberAvatar
          choices={choices}
          kind={agent.kind}
          seed={agent.id}
          size={88}
          title="Prévia do avatar"
        />
        <div className="grid flex-1 grid-cols-2 gap-2">
          {parts.map((part) => (
            <label key={part}>
              <span className="field-label">{PART_LABELS[part]}</span>
              <select
                className="field !h-8"
                value={choices[part]}
                onChange={(e) => setChoices({ ...choices, [part]: e.target.value })}
              >
                {AVATAR_PARTS[part].map((choice) => (
                  <option key={choice} value={choice}>
                    {CHOICE_LABELS[choice]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Button
        className="self-end"
        label="Salvar avatar"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await http(`/agent_directory/${agent.id}/avatar`, 'PUT', choices);
            onSaved();
          })
        }
      />
    </section>
  );
}
