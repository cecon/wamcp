import { useState, type Dispatch, type SetStateAction } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { http } from '../../api';
import type { AgentBot } from '../../adminTypes';
import type { Catalog, Delivery } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { DeliveriesPanel } from '../DeliveriesPanel';
import { useAction } from '../useAction';
import { AgentBotModal } from './AgentBotModal';
import { TokenModal } from './TokenNotice';

type Dialog =
  | { kind: 'edit'; bot: AgentBot | null }
  | { kind: 'delete' | 'reset'; bot: AgentBot }
  | { kind: 'token'; bot: AgentBot; token: string }
  | { kind: 'deliveries'; bot: AgentBot; list: Delivery[] };

interface Props {
  catalog: Catalog;
  /** Reloads the catalog (deleting a bot disconnects its inboxes). */
  onChange: () => Promise<void>;
}

/** Chatwoot Agent Bots: bots with their outgoing URL and inboxes, token reset and recent deliveries. */
export function AgentBotsPage({ catalog, onChange }: Props) {
  const { data, error: loadError, reload } = useFetch<AgentBot[]>('/agent_bots');
  const bots = data || [];
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { error, run } = useAction();
  const close = () => setDialog(null);
  const inboxNames = (bot: AgentBot) =>
    bot.inbox_ids
      .map((id) => catalog.inboxes.find((i) => i.id === id)?.name)
      .filter(Boolean)
      .join(', ') || '—';

  return (
    <SettingsPage>
      <SettingsHeader
        title="Robôs"
        description="Robôs de atendimento recebem os eventos das caixas conectadas na URL de saída e respondem pela API com o próprio token. Enquanto um robô estiver conectado, as conversas novas começam pendentes até ele transferir para a equipe."
        count={`${bots.length} robô${bots.length === 1 ? '' : 's'}`}
        action={
          <Button icon={Plus} label="Adicionar robô" onClick={() => setDialog({ kind: 'edit', bot: null })} />
        }
      />
      {(error || loadError) && <p className="text-sm text-n-ruby-11">{error || loadError}</p>}
      <Table
        headers={['Robô', 'URL de saída', 'Caixas conectadas', '']}
        rows={bots.length}
        empty="Nenhum robô ainda."
      >
        {bots.map((bot) => (
          <tr key={bot.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{bot.name}</span>
              {bot.description && <span className="text-sm">{bot.description}</span>}
            </Cell>
            <Cell className="break-all">{bot.outgoing_url}</Cell>
            <Cell>{inboxNames(bot)}</Cell>
            <Cell className="w-56">
              <div className="flex justify-end gap-1">
                <Button
                  color="slate"
                  variant="faded"
                  label="Entregas"
                  aria-label={`Entregas ${bot.name}`}
                  onClick={() =>
                    void run(async () =>
                      setDialog({
                        kind: 'deliveries',
                        bot,
                        list: await http(`/agent_bots/${bot.id}/deliveries`),
                      }),
                    )
                  }
                />
                <Button
                  color="slate"
                  variant="faded"
                  size="sm"
                  icon={KeyRound}
                  aria-label={`Gerar novo token ${bot.name}`}
                  title="Gerar novo token"
                  onClick={() => setDialog({ kind: 'reset', bot })}
                />
                <RowActions
                  labelFor={bot.name}
                  onEdit={() => setDialog({ kind: 'edit', bot })}
                  onDelete={() => setDialog({ kind: 'delete', bot })}
                />
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
      <BotDialogs dialog={dialog} setDialog={setDialog} onClose={close} reload={reload} onChange={onChange} />
    </SettingsPage>
  );
}

interface DialogsProps {
  dialog: Dialog | null;
  setDialog: Dispatch<SetStateAction<Dialog | null>>;
  onClose: () => void;
  reload: () => void;
  onChange: () => Promise<void>;
}

function BotDialogs({ dialog, setDialog, onClose, reload, onChange }: DialogsProps) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'edit':
      return <AgentBotModal bot={dialog.bot} onClose={onClose} onSaved={reload} />;
    case 'delete':
      return (
        <ConfirmModal
          title={`Excluir o robô “${dialog.bot.name}”?`}
          description="As caixas conectadas voltam ao atendimento humano e o token de acesso deixa de valer."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/agent_bots/${dialog.bot.id}`, 'DELETE');
            reload();
            await onChange();
          }}
          onClose={onClose}
        />
      );
    case 'reset':
      return (
        <ConfirmModal
          title={`Gerar novo token para “${dialog.bot.name}”?`}
          description="O token atual deixa de funcionar imediatamente; atualize o robô com o novo token."
          confirm="Gerar novo token"
          onConfirm={async () => {
            const { access_token } = await http<{ access_token: string }>(
              `/agent_bots/${dialog.bot.id}/reset_access_token`,
              'POST',
            );
            setDialog({ kind: 'token', bot: dialog.bot, token: access_token });
          }}
          onClose={() => setDialog((d) => (d?.kind === 'reset' ? null : d))}
        />
      );
    case 'token':
      return <TokenModal name={dialog.bot.name} token={dialog.token} onClose={onClose} />;
    case 'deliveries':
      return <DeliveriesPanel target={dialog.bot.outgoing_url} list={dialog.list} onClose={onClose} />;
  }
}
