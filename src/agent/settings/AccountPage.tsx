import { useState } from 'react';
import { http } from '../api';
import type { Account, Locale } from '../parityTypes';
import { useFetch } from '../useFetch';
import { Button } from '../ui/Button';
import { SettingsHeader, SettingsPage, Toggle } from '../ui/Settings';
import { useAction } from './useAction';

const LOCALES: Record<Locale, string> = { 'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español' };
const HEADER = {
  title: 'Configurações da conta',
  description: 'Nome, idioma e resolução automática de conversas inativas desta conta.',
};

/** Chatwoot account settings: general settings and auto-resolve of inactive conversations. */
export function AccountPage() {
  const { data, error } = useFetch<Account>('/account');
  return (
    <SettingsPage>
      <SettingsHeader {...HEADER} />
      {data ? (
        <AccountForm account={data} />
      ) : (
        <p className="text-sm text-n-slate-11">{error || 'Carregando…'}</p>
      )}
    </SettingsPage>
  );
}

function AccountForm({ account }: { account: Account }) {
  const days = account.settings?.auto_resolve_duration;
  const [form, setForm] = useState({
    name: account.name,
    locale: account.locale,
    autoResolve: Boolean(days),
    days: String(days || 7),
    message: account.settings?.auto_resolve_message || '',
  });
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  const set = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await http('/account', 'PATCH', {
            name: form.name.trim(),
            locale: form.locale,
            auto_resolve_duration: form.autoResolve ? Number(form.days) : null,
            auto_resolve_message: form.message.trim() || null,
          });
          setSaved(true);
        });
      }}
    >
      <label>
        <span className="field-label">Nome da conta</span>
        <input
          className="field"
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        <span className="field-label">Idioma</span>
        <select
          className="field"
          value={form.locale}
          onChange={(e) => set({ locale: e.target.value as Locale })}
        >
          {Object.entries(LOCALES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="border-t border-n-weak pt-2">
        <Toggle
          label="Resolver conversas inativas automaticamente"
          hint="Conversas abertas ou pendentes sem atividade são resolvidas após o período definido."
          checked={form.autoResolve}
          onChange={(autoResolve) => set({ autoResolve })}
        />
      </div>
      {form.autoResolve && (
        <label>
          <span className="field-label">Dias de inatividade</span>
          <input
            className="field"
            type="number"
            min={1}
            max={999}
            required
            value={form.days}
            onChange={(e) => set({ days: e.target.value })}
          />
        </label>
      )}
      <label>
        <span className="field-label">Mensagem da resolução automática</span>
        <textarea
          className="field"
          rows={3}
          maxLength={1000}
          placeholder="Enviada ao contato quando a conversa é resolvida por inatividade (opcional)."
          value={form.message}
          onChange={(e) => set({ message: e.target.value })}
        />
      </label>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      {saved && <p className="text-sm text-n-teal-11">Configurações da conta salvas.</p>}
      <Button type="submit" size="md" className="self-start" disabled={busy} label="Salvar alterações" />
    </form>
  );
}
