import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { GitPullRequest, MessageCircle, Settings, Smartphone } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';

import type { Catalog } from '../types';
import type { Route } from '../route';
import { ConnectGithubModal } from './github/ConnectGithubModal';
import { NewConnectionModal } from './connections/ConnectionsPage';
import { InboxDetail } from './InboxDetail';
import { channelLine } from './channelLine';
import { SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

interface Props {
  catalog: Catalog;
  inboxId?: number;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

/** Chatwoot Inboxes: channel tile list; each inbox opens a settings page with tabs. */
export function InboxesPage({ catalog, inboxId, onNavigate, onChange }: Props) {
  const inbox = inboxId ? catalog.inboxes.find((i) => i.id === inboxId) : undefined;
  const [adding, setAdding] = useState<'whatsapp' | 'github' | null>(null);
  const connection = (id: string) =>
    onNavigate({ page: 'settings', section: 'connections', connectionId: id });
  if (inbox)
    return <InboxDetail inbox={inbox} catalog={catalog} onNavigate={onNavigate} onChange={onChange} />;
  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Canais"
        description="Cada WhatsApp conectado e cada repositório do GitHub é um canal, com a sua caixa de entrada de conversas."
        count={`${catalog.inboxes.length} ${catalog.inboxes.length === 1 ? 'canal' : 'canais'}`}
        action={
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<Smartphone size={16} />}
              onClick={() => setAdding('whatsapp')}
            >
              Novo WhatsApp
            </Button>
            <Button
              variant="outlined"
              startIcon={<GitPullRequest size={16} />}
              onClick={() => setAdding('github')}
            >
              Conectar GitHub
            </Button>
          </Stack>
        }
      />
      <Panel flush>
        {catalog.inboxes.length === 0 ? (
          <Typography variant="body2" sx={{ py: 8, textAlign: 'center' }}>
            Nenhum canal ainda.
          </Typography>
        ) : (
          <Stack component="ul" divider={<Divider />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {catalog.inboxes.map((i) => (
              <Stack
                component="li"
                key={i.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', px: 2, py: 1.5 }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Box
                    component="span"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      width: 40,
                      height: 40,
                      borderRadius: 2,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'action.hover',
                    }}
                  >
                    {i.channel_type === 'github' ? <GitPullRequest size={22} /> : <MessageCircle size={22} />}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {i.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {channelLine(i)}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                  {i.channel_type !== 'github' && i.session_id && (
                    <IconButton
                      aria-label={`Conexão de ${i.name}`}
                      title="QR Code, status e acesso MCP"
                      onClick={() => connection(i.session_id!)}
                    >
                      <Smartphone size={18} />
                    </IconButton>
                  )}
                  <IconButton
                    aria-label={`Configurar ${i.name}`}
                    onClick={() => onNavigate({ page: 'settings', section: 'inboxes', id: i.id })}
                  >
                    <Settings size={18} />
                  </IconButton>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Panel>
      {adding === 'github' && <ConnectGithubModal onClose={() => setAdding(null)} onConnected={onChange} />}
      {adding === 'whatsapp' && (
        <NewConnectionModal
          onClose={() => setAdding(null)}
          onCreated={(created) => {
            void onChange().catch(() => {});
            connection(created.id);
          }}
        />
      )}
    </SettingsC3Page>
  );
}
