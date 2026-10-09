import { useCallback, useEffect, useState } from 'react';
import { http } from '../../api';
import { cn } from '../../ui/cn';
import { SettingsHeader, SettingsPage } from '../../ui/Settings';
import { ChatGptLink } from './ChatGptLink';
import { ConnectionStatus } from './ConnectionStatus';
import { HistoryViewer } from './HistoryViewer';
import { McpAccess } from './McpAccess';
import { AuditList } from './AuditList';
import { PairingPanel } from './PairingPanel';
import { formatPhone, sessionPath, type ConnectionDetail } from './model';

/** While the phone is not connected the page keeps asking for the QR Code and status. */
export const POLL_MS = 2000;

const TABS = [
  ['pairing', 'Conexão'],
  ['history', 'Histórico'],
  ['mcp', 'Acesso MCP'],
  ['chatgpt', 'ChatGPT'],
  ['audit', 'Atividade'],
] as const;
type Tab = (typeof TABS)[number][0];

interface Props {
  id: string;
  onBack: () => void;
  onChange: () => Promise<void>;
}

/** One WhatsApp connection: pairing (QR Code), history, MCP tokens, ChatGPT and activity. */
export function ConnectionDetailPage({ id, onBack, onChange }: Props) {
  const [detail, setDetail] = useState<ConnectionDetail | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState<Tab>('pairing');
  const load = useCallback(
    () =>
      http<ConnectionDetail>(sessionPath(id))
        .then((loaded) => {
          setDetail(loaded);
          setError('');
        })
        .catch((e: Error) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);
  const loaded = detail !== null,
    connected = detail?.status === 'connected';
  useEffect(() => {
    if (!loaded || connected) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [loaded, connected, load]);

  const back = { label: 'Conexões WhatsApp', onClick: onBack };
  if (!detail)
    return (
      <SettingsPage>
        <SettingsHeader title="Conexão" back={back} />
        {error ? (
          <p role="alert" className="text-sm text-n-ruby-11">
            {error}
          </p>
        ) : (
          <p className="text-sm text-n-slate-11">Carregando conexão…</p>
        )}
      </SettingsPage>
    );
  const refresh = async () => {
    await load();
    await onChange().catch(() => {});
  };
  return (
    <SettingsPage>
      <SettingsHeader title={detail.name} description={formatPhone(detail.phone)} back={back} />
      <div className="flex items-center gap-2">
        <ConnectionStatus status={detail.status} />
        {detail.error && <span className="text-sm text-n-ruby-11">{detail.error}</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <nav role="tablist" className="flex gap-4 border-b border-n-weak">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'relative py-2.5 text-sm font-medium',
              tab === value ? 'text-n-blue-11' : 'text-n-slate-11 hover:text-n-slate-12',
            )}
          >
            {label}
            {tab === value && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-n-brand" />}
          </button>
        ))}
      </nav>
      {tab === 'pairing' && <PairingPanel detail={detail} onRefresh={refresh} />}
      {tab === 'history' && <HistoryViewer id={id} />}
      {tab === 'mcp' && <McpAccess id={id} url={detail.mcpUrl || ''} />}
      {tab === 'chatgpt' && <ChatGptLink id={id} url={detail.mcpUrl || ''} />}
      {tab === 'audit' && <AuditList id={id} />}
    </SettingsPage>
  );
}
