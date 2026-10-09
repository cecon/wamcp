import { useState } from 'react';
import { LogOut, MessageCircle, RefreshCw, Unplug } from 'lucide-react';
import { http } from '../../api';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { QrCode } from '../../profile/qr/QrCode';
import { useAction } from '../useAction';
import { ACTIVE, sessionPath, type ConnectionDetail } from './model';

interface Props {
  detail: ConnectionDetail;
  onRefresh: () => Promise<void>;
}

/** The backend sends the QR Code as an image data URL; raw QR text is encoded in the browser. */
function Qr({ value }: { value: string }) {
  const label = 'QR Code para conectar o WhatsApp';
  return value.startsWith('data:image/') ? (
    <img src={value} alt={label} width={224} height={224} className="rounded-lg bg-white" />
  ) : (
    <QrCode value={value} size={224} label={label} />
  );
}

function Placeholder({ status }: { status: string }) {
  const connected = status === 'connected';
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <MessageCircle size={48} className={connected ? 'text-n-teal-10' : 'text-n-slate-9'} />
      <p className="text-heading-3 text-n-slate-12">
        {connected
          ? 'Tudo conectado'
          : status === 'connecting' || status === 'qr'
            ? 'Preparando o QR Code…'
            : 'Pronto para conectar'}
      </p>
      <p className="max-w-xs text-sm text-n-slate-11">
        {connected
          ? 'As mensagens chegam na caixa de entrada e a conexão está disponível para o MCP.'
          : 'Clique em Conectar WhatsApp para gerar o QR Code.'}
      </p>
    </div>
  );
}

/** Conexão tab: instructions, connect / disconnect / "Desconectar e sair" and the QR Code. */
export function PairingPanel({ detail, onRefresh }: Props) {
  const { error, busy, run } = useAction();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const action = (name: 'connect' | 'disconnect' | 'logout') =>
    http(`${sessionPath(detail.id)}/${name}`, 'POST').then(onRefresh);
  const active = ACTIVE.includes(detail.status);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_auto]">
      <div className="flex max-w-xl flex-col gap-4">
        <div>
          <h2 className="text-heading-3 text-n-slate-12">Conecte o WhatsApp</h2>
          <p className="text-sm text-n-slate-11">Vincule esta conexão como um aparelho conectado.</p>
        </div>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-n-slate-12">
          <li>Abra o WhatsApp no celular.</li>
          <li>
            Acesse <strong>Aparelhos conectados</strong>.
          </li>
          <li>
            Toque em <strong>Conectar aparelho</strong> e leia o QR Code.
          </li>
        </ol>
        {error && (
          <p role="alert" className="text-sm text-n-ruby-11">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={RefreshCw}
            label={detail.status === 'connected' ? 'WhatsApp conectado' : 'Conectar WhatsApp'}
            disabled={busy || active}
            onClick={() => void run(() => action('connect'))}
          />
          {active && (
            <Button
              color="slate"
              icon={Unplug}
              label="Desconectar"
              disabled={busy}
              onClick={() => void run(() => action('disconnect'))}
            />
          )}
          <Button
            color="ruby"
            variant="faded"
            icon={LogOut}
            label="Desconectar e sair"
            disabled={busy}
            onClick={() => setConfirmLogout(true)}
          />
        </div>
        <p className="text-sm text-n-slate-11">
          “Desconectar e sair” desvincula o celular e apaga as credenciais desta conexão. O histórico local e
          a caixa de entrada continuam.
        </p>
      </div>
      <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-n-weak bg-n-solid-1 p-4 md:w-72">
        {detail.qr ? <Qr value={detail.qr} /> : <Placeholder status={detail.status} />}
        <small className="text-xs text-n-slate-11">
          {detail.qr ? 'O QR Code é atualizado automaticamente.' : 'A conexão fica salva neste computador.'}
        </small>
      </div>
      {confirmLogout && (
        <ConfirmModal
          title="Desconectar e sair?"
          description="O WhatsApp deixa de estar vinculado a esta conexão. Para voltar, será preciso ler um novo QR Code."
          confirm="Desconectar e sair"
          onConfirm={() => action('logout')}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
