import { useCallback, useEffect, useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

// third-party
import { ArrowLeft } from 'lucide-react';

import { http } from '../../api';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
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

  const back = (
    <Button variant="text" startIcon={<ArrowLeft size={16} />} onClick={onBack}>
      Canais
    </Button>
  );
  if (!detail)
    return (
      <SettingsC3Page>
        <SettingsC3Header title="Conexão" action={back} />
        {error ? (
          <SettingsC3Error>{error}</SettingsC3Error>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Carregando conexão…
          </Typography>
        )}
      </SettingsC3Page>
    );
  const refresh = async () => {
    await load();
    await onChange().catch(() => {});
  };
  return (
    <SettingsC3Page>
      <SettingsC3Header title={detail.name} description={formatPhone(detail.phone)} action={back} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ConnectionStatus status={detail.status} />
        {detail.error && (
          <Typography variant="body2" sx={{ color: 'error.main' }}>
            {detail.error}
          </Typography>
        )}
      </Stack>
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Tabs value={tab} onChange={(_event, value: Tab) => setTab(value)} aria-label="Conexão">
        {TABS.map(([value, label]) => (
          <Tab key={value} value={value} label={label} />
        ))}
      </Tabs>
      {tab === 'pairing' && <PairingPanel detail={detail} onRefresh={refresh} />}
      {tab === 'history' && <HistoryViewer id={id} />}
      {tab === 'mcp' && <McpAccess id={id} url={detail.mcpUrl || ''} />}
      {tab === 'chatgpt' && <ChatGptLink id={id} url={detail.mcpUrl || ''} />}
      {tab === 'audit' && <AuditList id={id} />}
    </SettingsC3Page>
  );
}
