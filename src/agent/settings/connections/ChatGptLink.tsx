import { useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SecretField } from '../../ui/SecretField';
import { useAction } from '../useAction';
import {
  formatDate,
  SCOPES,
  scopeLabel,
  sessionPath,
  type ChatGptGrant,
  type ChatGptLinkCode,
} from './model';

/** ChatGPT tab: one-time code for the OAuth consent page, and the authorized connections. */
export function ChatGptLink({ id, url }: { id: string; url: string }) {
  const base = `${sessionPath(id)}/chatgpt`;
  const { data, error: loadError, reload } = useFetch<ChatGptGrant[]>(base);
  const [scope, setScope] = useState('read'),
    [code, setCode] = useState<ChatGptLinkCode | null>(null),
    [revoking, setRevoking] = useState<ChatGptGrant | null>(null);
  const { error, busy, run } = useAction();
  const grants = data || [];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ol className="list-decimal space-y-1 ps-5 text-sm text-n-slate-12">
        <li>No ChatGPT, ative o modo de desenvolvedor nas configurações, se disponível para sua conta.</li>
        <li>
          Crie a conexão WA MCP com o endereço abaixo e escolha <strong>OAuth</strong>, deixando Client ID e
          Client Secret vazios.
        </li>
        <li>Gere o código aqui e cole na página de autorização aberta pelo ChatGPT.</li>
      </ol>
      <SecretField
        label="URL do servidor MCP para o ChatGPT"
        secret={url}
        copyLabel="Copiar URL do ChatGPT"
      />
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="field-label">Permissão do ChatGPT</span>
          <select className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="md"
          label="Gerar código para o ChatGPT"
          disabled={busy}
          onClick={() =>
            void run(async () => setCode(await http<ChatGptLinkCode>(`${base}/link`, 'POST', { scope })))
          }
        />
      </div>
      {(error || loadError) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error || loadError}
        </p>
      )}
      {code && (
        <div className="flex flex-col gap-2 rounded-xl border border-n-weak bg-n-solid-2 p-4">
          <p className="text-sm font-medium text-n-slate-12">Código de uso único, válido por dez minutos</p>
          <SecretField label="Código para o ChatGPT" secret={code.code} copyLabel="Copiar código" />
          <p className="text-xs text-n-slate-11">
            Expira às {new Date(code.expires).toLocaleTimeString('pt-BR')}. Cole somente na página de
            autorização do WA MCP.
          </p>
          <Button
            color="slate"
            variant="link"
            className="self-start"
            label="Ocultar código"
            onClick={() => setCode(null)}
          />
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-heading-3 text-n-slate-12">Conexões autorizadas</h3>
        <Button color="slate" variant="link" label="Atualizar" onClick={reload} />
      </div>
      <ul className="divide-y divide-n-weak border-t border-n-weak" aria-label="Conexões do ChatGPT">
        {data && grants.length === 0 && (
          <li className="py-6 text-sm text-n-slate-11">Nenhuma conexão do ChatGPT autorizada.</li>
        )}
        {grants.map((g) => (
          <li key={g.id} className="flex items-center gap-3 py-3">
            <ShieldCheck size={18} className="shrink-0 text-n-teal-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-n-slate-12">{g.name}</p>
              <p className="text-xs text-n-slate-11">
                {scopeLabel(g.scope)} · Até {formatDate(g.expires)}
              </p>
            </div>
            <Button
              color="slate"
              variant="faded"
              icon={Trash2}
              aria-label={`Desconectar ${g.name}`}
              onClick={() => setRevoking(g)}
            />
          </li>
        ))}
      </ul>
      {revoking && (
        <ConfirmModal
          title={`Desconectar ${revoking.name}?`}
          description="O ChatGPT perde o acesso a esta conexão até ser autorizado de novo."
          confirm="Desconectar"
          onConfirm={async () => {
            await http(`${base}/${encodeURIComponent(revoking.id)}`, 'DELETE');
            reload();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
