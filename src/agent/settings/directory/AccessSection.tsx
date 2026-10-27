import type { RosterAgent } from '../../adminTypes';
import type { Role } from '../../types';
import type { NewAccess } from './access';
import { Button } from '../../ui/Button';

interface Props {
  agent: RosterAgent | null;
  access: NewAccess;
  onChange: (access: NewAccess) => void;
  /** Opens the login settings (access type, two-step verification, deactivation). */
  onManage: (userId: number) => void;
}

/** Optional helpdesk access of a person: shown when linked, or created with e-mail and password. */
export function AccessSection({ agent, access, onChange, onManage }: Props) {
  if (agent?.user_id) {
    const userId = agent.user_id;
    return (
      <fieldset className="flex flex-col gap-2" aria-label="Acesso ao helpdesk">
        <legend className="field-label">Acesso ao helpdesk</legend>
        <p className="text-sm text-n-slate-12">{agent.user_email}</p>
        <Button
          color="slate"
          variant="faded"
          size="sm"
          className="self-start"
          label="Gerenciar acesso"
          onClick={() => onManage(userId)}
        />
      </fieldset>
    );
  }
  return (
    <fieldset className="flex flex-col gap-3" aria-label="Acesso ao helpdesk">
      <legend className="field-label">Acesso ao helpdesk</legend>
      <label className="flex items-center gap-2 text-sm text-n-slate-12">
        <input
          type="checkbox"
          className="size-4 accent-n-brand"
          checked={access.enabled}
          onChange={(e) => onChange({ ...access, enabled: e.target.checked })}
        />
        Dar acesso ao helpdesk (entrar e atender conversas)
      </label>
      {access.enabled && (
        <>
          <label>
            <span className="field-label">E-mail</span>
            <input
              className="field"
              type="email"
              required
              value={access.email}
              onChange={(e) => onChange({ ...access, email: e.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Senha inicial (mín. 10 caracteres)</span>
            <input
              className="field"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
              value={access.password}
              onChange={(e) => onChange({ ...access, password: e.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Tipo de acesso</span>
            <select
              className="field"
              value={access.role}
              onChange={(e) => onChange({ ...access, role: e.target.value as Role })}
            >
              <option value="agent">Agente</option>
              <option value="administrator">Administrador</option>
            </select>
          </label>
        </>
      )}
    </fieldset>
  );
}
