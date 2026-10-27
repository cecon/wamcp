import { useState } from 'react';
import { http } from '../../api';
import type { AgentCredential } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { useAction } from '../useAction';
import { CREDENTIAL_KINDS } from './labels';

interface Props {
  agentId: number;
  onChange: () => void;
}

/** Credentials of an AI agent: secrets are write-only and encrypted on the server. */
export function CredentialsPanel({ agentId, onChange }: Props) {
  const path = `/agent_directory/${agentId}/credentials`;
  const { data, reload } = useFetch<AgentCredential[]>(path);
  const [form, setForm] = useState({ name: '', kind: CREDENTIAL_KINDS[0].value as string, secret: '' });
  const { error, busy, run } = useAction();
  const changed = () => {
    reload();
    onChange();
  };

  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-n-weak pt-4" aria-label="Credenciais">
      <h3 className="font-medium text-n-slate-12">Credenciais</h3>
      <p className="text-sm">
        Usadas pelas ferramentas do agente no servidor; o modelo nunca vê o segredo, que fica cifrado e não
        pode ser lido de volta.
      </p>
      <ul className="flex flex-col gap-1.5">
        {(data || []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium text-n-slate-12">{c.name}</span>{' '}
              {CREDENTIAL_KINDS.find((k) => k.value === c.kind)?.label}
            </span>
            <Button
              color="ruby"
              variant="faded"
              size="sm"
              label="Remover"
              aria-label={`Remover credencial ${c.name}`}
              onClick={() =>
                void run(async () => {
                  await http(`${path}/${c.id}`, 'DELETE');
                  changed();
                })
              }
            />
          </li>
        ))}
        {data?.length === 0 && <li className="text-sm">Nenhuma credencial.</li>}
      </ul>
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http(path, 'POST', { ...form, name: form.name.trim() });
            setForm({ ...form, name: '', secret: '' });
            changed();
          });
        }}
      >
        <input
          className="field"
          required
          maxLength={60}
          placeholder="nome (ex.: erp_api)"
          aria-label="Nome da credencial"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          className="field"
          aria-label="Tipo da credencial"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          {CREDENTIAL_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          className="field"
          required
          type="password"
          autoComplete="new-password"
          placeholder="segredo"
          aria-label="Segredo"
          value={form.secret}
          onChange={(e) => setForm({ ...form, secret: e.target.value })}
        />
        <div className="sm:col-span-3">
          <Button type="submit" label="Adicionar credencial" disabled={busy} />
        </div>
      </form>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
    </section>
  );
}
