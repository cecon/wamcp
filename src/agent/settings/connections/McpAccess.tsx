import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SecretField } from '../../ui/SecretField';
import { useAction } from '../useAction';
import { formatDate, SCOPES, scopeLabel, sessionPath, type McpToken } from './model';

const DAYS = [30, 90, 180, 365];

/** Acesso MCP tab: the connection's MCP address and its Bearer tokens (shown once on creation). */
export function McpAccess({ id, url }: { id: string; url: string }) {
  const path = `${sessionPath(id)}/tokens`;
  const { data, error: loadError, reload } = useFetch<McpToken[]>(path);
  const [form, setForm] = useState({ name: '', scope: 'read', days: 90 }),
    [fresh, setFresh] = useState<McpToken | null>(null),
    [revoking, setRevoking] = useState<McpToken | null>(null);
  const { error, busy, run } = useAction();
  const tokens = data || [];
  const config = JSON.stringify(
    {
      mcpServers: { whatsapp: { url, headers: { Authorization: `Bearer ${fresh?.token || 'SEU_TOKEN'}` } } },
    },
    null,
    2,
  );
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SecretField label="Endereço MCP desta conexão" secret={url} copyLabel="Copiar endereço MCP" />
      <p className="text-sm text-n-slate-11">
        Cada token acessa somente esta conexão. Gere uma credencial diferente para cada integração.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setFresh(await http<McpToken>(path, 'POST', { ...form, name: form.name.trim() }));
            setForm({ ...form, name: '' });
            reload();
          });
        }}
      >
        <label className="min-w-48 flex-1">
          <span className="field-label">Nome da integração</span>
          <input
            className="field"
            required
            maxLength={80}
            value={form.name}
            placeholder="Ex.: Claude Desktop"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Permissão</span>
          <select
            className="field"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Validade</span>
          <select
            className="field"
            value={form.days}
            onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          size="md"
          icon={Plus}
          label="Gerar token"
          disabled={busy || !form.name.trim()}
        />
      </form>
      {(error || loadError) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error || loadError}
        </p>
      )}
      {fresh?.token && (
        <div className="flex flex-col gap-2 rounded-xl border border-n-amber-9 bg-n-amber-3 p-4">
          <p className="text-sm font-medium text-n-amber-12">Copie agora. Este token só aparece uma vez.</p>
          <SecretField label="Token de acesso" secret={fresh.token} copyLabel="Copiar token" />
          <p className="text-xs text-n-amber-12">Expira em {formatDate(fresh.expires)}.</p>
          <Button
            color="slate"
            variant="link"
            className="self-start"
            label="Já copiei, ocultar token"
            onClick={() => setFresh(null)}
          />
        </div>
      )}
      <ul className="divide-y divide-n-weak border-t border-n-weak" aria-label="Tokens MCP">
        {data && tokens.length === 0 && (
          <li className="py-6 text-sm text-n-slate-11">Nenhum token criado para esta conexão.</li>
        )}
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-3">
            <KeyRound size={18} className="shrink-0 text-n-slate-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-n-slate-12">{t.name}</p>
              <p className="text-xs text-n-slate-11">
                {scopeLabel(t.scope)} · Expira em {formatDate(t.expires)}
                {t.last_used ? ` · Último uso ${formatDate(t.last_used)}` : ''}
              </p>
            </div>
            <Button
              color="slate"
              variant="faded"
              icon={Trash2}
              aria-label={`Revogar ${t.name}`}
              onClick={() => setRevoking(t)}
            />
          </li>
        ))}
      </ul>
      <div>
        <h3 className="text-heading-3 text-n-slate-12">Configuração do cliente</h3>
        <p className="mb-2 text-sm text-n-slate-11">
          Para clientes que aceitam URL HTTP (Streamable HTTP) e cabeçalhos personalizados.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-n-solid-3 p-3 text-xs" aria-label="Configuração MCP">
          {config}
        </pre>
      </div>
      {revoking && (
        <ConfirmModal
          title={`Revogar ${revoking.name}?`}
          description="A integração perde o acesso imediatamente."
          confirm="Revogar"
          onConfirm={async () => {
            await http(`${path}/${encodeURIComponent(revoking.id)}`, 'DELETE');
            if (fresh?.id === revoking.id) setFresh(null);
            reload();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
