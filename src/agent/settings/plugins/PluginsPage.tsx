import { useState } from 'react';
import { KeyRound, Plus, RefreshCw } from 'lucide-react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table, Toggle } from '../../ui/Settings';
import { useAction } from '../useAction';
import { CredentialsModal } from './CredentialsModal';
import { InstallModal } from './InstallModal';
import type { Plugin, UpdateOutcome } from './types';

const KIND = { http: 'HTTP', mcp: 'MCP', builtin: 'do app' };

/** Plugins decide what the agents can do: each brings skills, tools (HTTP or MCP) and the
 * credentials those tools need. */
export function PluginsPage() {
  const { data, error, reload } = useFetch<Plugin[]>('/plugins');
  const [installing, setInstalling] = useState(false),
    [credentials, setCredentials] = useState<Plugin | null>(null),
    [removing, setRemoving] = useState<Plugin | null>(null);
  const toggling = useAction();
  const [notice, setNotice] = useState('');
  const plugins = data || [];

  return (
    <SettingsPage wide>
      <SettingsHeader
        title="Plugins"
        description="O que os agentes sabem fazer vem dos plugins: skills com as instruções, ferramentas HTTP ou MCP e as credenciais que elas usam. Depois de instalar, libere as ferramentas para cada agente em Motor de agentes."
        count={`${plugins.length} plugin${plugins.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Instalar plugin" onClick={() => setInstalling(true)} />}
      />
      {(error || toggling.error) && <p className="text-sm text-n-ruby-11">{error || toggling.error}</p>}
      {notice && (
        <p role="status" className="text-sm text-n-teal-11">
          {notice}
        </p>
      )}
      <Table
        headers={['Plugin', 'Ferramentas', 'Ativo', '']}
        rows={plugins.length}
        empty="Nenhum plugin instalado."
      >
        {plugins.map((plugin) => {
          const { manifest } = plugin;
          const missing = manifest.credentials.filter((c) => !plugin.credentials_set.includes(c.name));
          return (
            <tr key={manifest.id}>
              <Cell>
                <span className="block font-medium text-n-slate-12">
                  {manifest.name} <span className="text-sm font-normal">v{manifest.version}</span>
                </span>
                {manifest.description && <span className="block text-sm">{manifest.description}</span>}
                <span className="block text-sm">
                  {manifest.skills.length} skill{manifest.skills.length === 1 ? '' : 's'}
                  {plugin.builtin && ' · vem com o app'}
                </span>
                {missing.length > 0 && (
                  <span className="block text-sm text-n-amber-11">
                    Falta configurar: {missing.map((c) => c.name).join(', ')}
                  </span>
                )}
              </Cell>
              <Cell className="break-all">
                {manifest.tools.map((tool) => (
                  <span key={tool.name} className="block" title={tool.description}>
                    {manifest.id}.{tool.name}{' '}
                    <span className="text-xs">
                      ({KIND[tool.endpoint.kind]}
                      {tool.side_effects ? ', altera dados' : ''}
                      {tool.internal_only ? ', só interno' : ''})
                    </span>
                  </span>
                ))}
              </Cell>
              <Cell className="w-20">
                <Toggle
                  compact
                  label={`Ativar ${manifest.name}`}
                  checked={plugin.enabled}
                  onChange={(enabled) =>
                    void toggling.run(async () => {
                      await http(`/plugins/${manifest.id}`, 'PATCH', { enabled });
                      reload();
                    })
                  }
                />
              </Cell>
              <Cell className="w-40">
                <div className="flex justify-end gap-1">
                  {plugin.source && (
                    <Button
                      color="slate"
                      variant="faded"
                      size="sm"
                      icon={RefreshCw}
                      aria-label={`Atualizar ${manifest.name}`}
                      disabled={toggling.busy}
                      onClick={() =>
                        void toggling.run(async () => {
                          setNotice('');
                          const outcome = await http<UpdateOutcome>(
                            `/plugins/${manifest.id}/update`,
                            'POST',
                            {},
                          );
                          setNotice(
                            outcome.updated
                              ? `${manifest.name} atualizado de ${outcome.previous_version} para ${outcome.plugin.manifest.version}.`
                              : `${manifest.name} já está na versão mais nova (${outcome.previous_version}).`,
                          );
                          reload();
                        })
                      }
                    />
                  )}
                  {manifest.credentials.length > 0 && (
                    <Button
                      color="slate"
                      variant="faded"
                      size="sm"
                      icon={KeyRound}
                      aria-label={`Credenciais de ${manifest.name}`}
                      onClick={() => setCredentials(plugin)}
                    />
                  )}
                  {!plugin.builtin && (
                    <RowActions labelFor={manifest.name} onDelete={() => setRemoving(plugin)} />
                  )}
                </div>
              </Cell>
            </tr>
          );
        })}
      </Table>
      {installing && <InstallModal onClose={() => setInstalling(false)} onSaved={reload} />}
      {credentials && (
        <CredentialsModal plugin={credentials} onClose={() => setCredentials(null)} onSaved={reload} />
      )}
      {removing && (
        <ConfirmModal
          title={`Remover o plugin “${removing.manifest.name}”?`}
          description="As skills dele saem da biblioteca e as credenciais são apagadas. Os agentes perdem essas ferramentas."
          confirm="Remover"
          onConfirm={async () => {
            await http(`/plugins/${removing.manifest.id}`, 'DELETE');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}
