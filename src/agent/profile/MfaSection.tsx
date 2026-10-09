import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { http } from '../api';
import type { MfaSetup } from '../accountTypes';
import { useAction } from '../settings/useAction';
import { Button } from '../ui/Button';
import { BackupCodesModal } from './BackupCodes';
import { DisableMfaModal, MfaSetupModal } from './MfaModals';

/** Two-factor status with the enable flow (QR → code → backup codes) and the disable dialog. */
export function MfaSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [setup, setSetup] = useState<MfaSetup | null>(null),
    [codes, setCodes] = useState<string[] | null>(null),
    [disabling, setDisabling] = useState(false);
  const { error, busy, run } = useAction();
  useEffect(() => {
    http<{ enabled: boolean }>('/profile/mfa')
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);
  if (enabled === null) return <p className="text-sm text-n-slate-11">Carregando…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-xl border border-n-weak p-4">
        {enabled ? (
          <ShieldCheck size={20} className="shrink-0 text-n-teal-11" />
        ) : (
          <ShieldOff size={20} className="shrink-0 text-n-slate-10" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium text-n-slate-12">
            {enabled
              ? 'A verificação em duas etapas está ativa'
              : 'A verificação em duas etapas está desativada'}
          </p>
          <p className="text-sm text-n-slate-11">
            {enabled
              ? 'Sua conta está protegida com uma camada extra de segurança.'
              : 'Ao entrar, além da senha será pedido o código do aplicativo autenticador (Google Authenticator, Authy…).'}
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      {enabled ? (
        <Button
          color="ruby"
          variant="faded"
          className="self-start"
          label="Desativar verificação em duas etapas"
          onClick={() => setDisabling(true)}
        />
      ) : (
        <Button
          className="self-start"
          label="Ativar verificação em duas etapas"
          disabled={busy}
          onClick={() => void run(async () => setSetup(await http<MfaSetup>('/profile/mfa', 'POST')))}
        />
      )}
      {setup && (
        <MfaSetupModal
          setup={setup}
          onClose={() => setSetup(null)}
          onEnabled={(backup) => {
            setSetup(null);
            setEnabled(true);
            setCodes(backup);
          }}
        />
      )}
      {codes && <BackupCodesModal codes={codes} onClose={() => setCodes(null)} />}
      {disabling && (
        <DisableMfaModal
          onClose={() => setDisabling(false)}
          onDisabled={() => {
            setDisabling(false);
            setEnabled(false);
          }}
        />
      )}
    </div>
  );
}
