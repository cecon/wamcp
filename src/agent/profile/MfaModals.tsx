import { useState } from 'react';
import { Copy } from 'lucide-react';
import { http } from '../api';
import type { MfaSetup } from '../accountTypes';
import { useAction } from '../settings/useAction';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';
import { copyText } from './browser';
import { QrCode } from './qr/QrCode';

/** 6-digit TOTP input (also accepts a backup code where `backup` is set). */
export function CodeInput({
  value,
  onChange,
  label,
  backup,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  backup?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        className="field font-mono tracking-widest"
        value={value}
        required
        inputMode={backup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={backup ? 20 : 6}
        placeholder="000000"
        onChange={(e) => onChange(backup ? e.target.value : e.target.value.replace(/\D/g, ''))}
      />
    </label>
  );
}

interface SetupProps {
  setup: MfaSetup;
  onClose: () => void;
  onEnabled: (backupCodes: string[]) => void;
}

/** Enrolment: scan the QR (or type the secret), then confirm with a code from the app. */
export function MfaSetupModal({ setup, onClose, onEnabled }: SetupProps) {
  const [code, setCode] = useState(''),
    [copied, setCopied] = useState(false);
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Ativar verificação em duas etapas"
      description="Use o Google Authenticator, Authy ou qualquer aplicativo compatível com TOTP."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await http<{ backup_codes: string[] }>('/profile/mfa/verify', 'POST', { code });
            onEnabled(result.backup_codes);
          });
        }}
      >
        <p className="text-sm font-medium text-n-slate-12">
          1. Escaneie o QR Code com o aplicativo autenticador
        </p>
        <div className="flex justify-center">
          <QrCode value={setup.otpauth_uri} label="QR Code para o aplicativo autenticador" />
        </div>
        <div>
          <p className="text-sm text-n-slate-11">
            Não consegue escanear? Digite a chave secreta manualmente:
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code
              aria-label="Chave secreta"
              className="flex-1 rounded-lg bg-n-alpha-1 px-3 py-2 font-mono text-sm break-all"
            >
              {setup.secret}
            </code>
            <Button
              color="slate"
              variant="faded"
              icon={Copy}
              label={copied ? 'Copiada' : 'Copiar'}
              onClick={() => void copyText(setup.secret).then(setCopied)}
            />
          </div>
        </div>
        <p className="text-sm font-medium text-n-slate-12">
          2. Informe o código de 6 dígitos gerado pelo aplicativo
        </p>
        <CodeInput label="Código de verificação" value={code} onChange={setCode} />
        <ModalFooter
          busy={busy || code.length !== 6}
          submit="Verificar e ativar"
          onCancel={onClose}
          error={error}
        />
      </form>
    </Modal>
  );
}

interface DisableProps {
  onClose: () => void;
  onDisabled: () => void;
}

/** Turning two-factor off asks for the password and a current (or backup) code. */
export function DisableMfaModal({ onClose, onDisabled }: DisableProps) {
  const [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Desativar verificação em duas etapas"
      description="Informe sua senha e um código de verificação (ou de recuperação) para desativar."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/profile/mfa', 'DELETE', { password, code });
            onDisabled();
          });
        }}
      >
        <label className="block">
          <span className="field-label">Senha</span>
          <input
            className="field"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <CodeInput label="Código de verificação" value={code} onChange={setCode} backup />
        <ModalFooter busy={busy} submit="Desativar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
