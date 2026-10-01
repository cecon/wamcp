import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';
const statusLabel: Record<string, string> = {
  connected: 'Conectada',
  disconnected: 'Desconectada',
  connecting: 'Conectando',
  qr: 'Aguardando QR Code',
  reconnecting: 'Reconectando',
  logged_out: 'Conecte novamente',
  error: 'Erro de conexão',
};
export function Status({ value }: { value: string }) {
  return (
    <span className={`badge ${value === 'connected' ? 'green' : ''}`}>
      <i />
      {statusLabel[value] || value}
    </span>
  );
}
export function Logo() {
  return (
    <span className="logo">
      <MessageCircle size={27} />
      <i />
    </span>
  );
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      title="Copiar"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <MessageCircle size={38} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
