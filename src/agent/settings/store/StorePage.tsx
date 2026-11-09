import { useState } from 'react';
import { BookOpen, Download, Link2, RefreshCw } from 'lucide-react';

// material-ui
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

// C3Theme
import { StatusChip } from '@c3theme/ui';

import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import type { Plugin } from '../plugins/types';
import { useAction } from '../useAction';
import { AgentInstallModal } from './AgentInstallModal';
import { SourceModal } from './SourceModal';
import { CardGrid, StoreCard } from './StoreCard';
import type { Installed, Store, StoreAgent } from './types';

type View = 'agents' | 'skills';

/** What is installed here of a skill, in one line of status chips. */
function InstalledLine({ installed, store }: { installed: Installed | null; store: string }) {
  if (!installed) return null;
  const missing = installed.credentials_missing;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <StatusChip
        label={`Instalado v${installed.version}${installed.enabled ? '' : ' (desativado)'}`}
        tone={installed.enabled ? 'success' : 'neutral'}
      />
      {installed.update && <StatusChip label={`v${store} disponível`} tone="info" />}
      {missing.length > 0 && <StatusChip label={`Falta configurar: ${missing.join(', ')}`} tone="warning" />}
    </Stack>
  );
}

/** The store: agent templates (a plugin plus the agent that uses it) and skills (plugins), read
 * from a catalog anyone can publish. Installing a template sets the agent up in one step. */
export function StorePage() {
  const { data, error, reload } = useFetch<Store>('/store');
  const [view, setView] = useState<View>('agents'),
    [template, setTemplate] = useState<StoreAgent | null>(null),
    [source, setSource] = useState(false),
    [notice, setNotice] = useState('');
  const installing = useAction();
  const store = data;
  const versionOf = (id: string) => store?.plugins.find((p) => p.id === id)?.version || '';

  const installSkill = (id: string, name: string) =>
    void installing.run(async () => {
      setNotice('');
      const plugin = await http<Plugin>(`/store/plugins/${id}`, 'POST', {});
      setNotice(
        `${name} v${plugin.manifest.version} instalado. Configure as credenciais e libere as ferramentas.`,
      );
      reload();
    });

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Loja"
        description="Agentes prontos e habilidades para instalar. Um agente da loja instala a habilidade dele, pede as credenciais, cria o agente, libera as ferramentas e cria as rotinas, tudo de uma vez."
        count={store ? `Lendo de ${store.default_source ? 'a loja do WAMCP' : store.source}` : undefined}
        action={
          <Button
            color="slate"
            variant="faded"
            icon={Link2}
            label="Endereço da loja"
            onClick={() => setSource(true)}
          />
        }
      />
      {(error || installing.error) && <SettingsC3Error>{error || installing.error}</SettingsC3Error>}
      {notice && (
        <Typography role="status" variant="body2" color="success.main">
          {notice}
        </Typography>
      )}
      <Tabs value={view} onChange={(_, value: View) => setView(value)} aria-label="Seções da loja">
        <Tab value="agents" label={`Agentes${store ? ` (${store.agents.length})` : ''}`} />
        <Tab value="skills" label={`Habilidades${store ? ` (${store.plugins.length})` : ''}`} />
      </Tabs>
      {store && view === 'agents' && (
        <CardGrid>
          {store.agents.map((agent) => (
            <StoreCard
              key={agent.id}
              {...agent}
              status={<InstalledLine installed={agent.plugin_installed} store={versionOf(agent.plugin)} />}
              actions={
                <Button
                  icon={Download}
                  label="Instalar"
                  aria-label={`Instalar o agente ${agent.name}`}
                  onClick={() => setTemplate(agent)}
                />
              }
            />
          ))}
        </CardGrid>
      )}
      {store && view === 'skills' && (
        <CardGrid>
          {store.plugins.map((plugin) => {
            const action = !plugin.installed ? 'Instalar' : plugin.installed.update ? 'Atualizar' : null;
            return (
              <StoreCard
                key={plugin.id}
                {...plugin}
                status={<InstalledLine installed={plugin.installed} store={plugin.version} />}
                actions={
                  <>
                    {plugin.docs && (
                      <Link
                        href={plugin.docs}
                        target="_blank"
                        rel="noreferrer"
                        variant="body2"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 'auto' }}
                      >
                        <BookOpen size={14} aria-hidden />
                        Como ligar
                      </Link>
                    )}
                    {action && (
                      <Button
                        icon={action === 'Instalar' ? Download : RefreshCw}
                        label={action}
                        aria-label={`${action} ${plugin.name}`}
                        disabled={installing.busy}
                        onClick={() => installSkill(plugin.id, plugin.name)}
                      />
                    )}
                  </>
                }
              />
            );
          })}
        </CardGrid>
      )}
      {template && (
        <AgentInstallModal
          template={template}
          onClose={() => setTemplate(null)}
          onInstalled={() => reload()}
        />
      )}
      {source && store && (
        <SourceModal
          current={store.default_source ? '' : store.source}
          onClose={() => setSource(false)}
          onSaved={() => {
            setNotice('');
            reload();
          }}
        />
      )}
    </SettingsC3Page>
  );
}
