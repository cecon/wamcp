import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SettingsHeader, SettingsPage } from '../../ui/Settings';
import { useAction } from '../useAction';
import type { LiveActivity, LiveAgent, LiveAnswer } from './types';

const STATUS: Record<string, string> = {
  queued: 'na fila',
  running: 'executando',
  waiting_approval: 'aguardando aprovação',
};

type Stopping = { kind: 'answer'; answer: LiveAnswer } | { kind: 'activity'; activity: LiveActivity };

function since(ms: number | null) {
  if (!ms) return 'na fila';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return seconds < 60 ? `respondendo há ${seconds}s` : `respondendo há ${Math.round(seconds / 60)} min`;
}

const answerLabel = (a: LiveAnswer) =>
  a.kind === 'conversation' ? `Conversa #${a.display_id}` : `Chat #${a.id}`;

/** What each AI agent is doing now: pause or resume it, stop an answer or cancel a request. */
export function LiveAgentsPage() {
  const { data, error, reload } = useFetch<LiveAgent[]>('/agents/live');
  const [stopping, setStopping] = useState<Stopping | null>(null);
  const action = useAction();
  useEffect(() => {
    const timer = window.setInterval(reload, 3000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const agents = data || [];

  return (
    <SettingsPage wide>
      <SettingsHeader
        title="Agentes ao vivo"
        description="O que cada agente de IA está fazendo agora. Um agente pausado não responde nem começa pedidos; o que chegar espera e é atendido quando ele for retomado. Encerrar uma resposta passa a conversa para as pessoas da caixa."
        count={`${agents.length} agente${agents.length === 1 ? '' : 's'} de IA`}
      />
      {(error || action.error) && <p className="text-sm text-n-ruby-11">{error || action.error}</p>}
      {agents.length === 0 && !error && (
        <p className="text-sm text-n-slate-11">Nenhum agente de IA cadastrado.</p>
      )}
      <div className="flex flex-col gap-3">
        {agents.map((agent) => (
          <section
            key={agent.id}
            aria-label={`Agente ${agent.name}`}
            className="rounded-lg border border-n-weak p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-heading-3 text-n-slate-12">{agent.name}</span>{' '}
                <span className="text-sm text-n-slate-11">
                  {agent.paused ? 'Pausado' : agent.active ? 'Ativo' : 'Desativado'}
                </span>
              </div>
              <Button
                icon={agent.paused ? Play : Pause}
                color="slate"
                variant="faded"
                size="sm"
                label={agent.paused ? 'Retomar' : 'Pausar'}
                aria-label={`${agent.paused ? 'Retomar' : 'Pausar'} ${agent.name}`}
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await http(`/agents/live/${agent.id}/paused`, 'PUT', { paused: !agent.paused });
                    reload();
                  })
                }
              />
            </div>
            {agent.answers.length === 0 && agent.activities.length === 0 && (
              <p className="mt-2 text-sm text-n-slate-11">Sem nada em andamento.</p>
            )}
            <ul className="mt-2 flex flex-col gap-1">
              {agent.answers.map((answer) => (
                <li
                  key={`${answer.kind}-${answer.id}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {answerLabel(answer)} · {since(answer.since)}
                  </span>
                  <Button
                    color="ruby"
                    variant="faded"
                    size="sm"
                    label="Encerrar"
                    aria-label={`Encerrar ${answerLabel(answer)}`}
                    onClick={() => setStopping({ kind: 'answer', answer })}
                  />
                </li>
              ))}
              {agent.activities.map((activity) => (
                <li
                  key={`activity-${activity.id}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    Pedido #{activity.id} · {STATUS[activity.status] || activity.status} · {activity.request}
                  </span>
                  <Button
                    color="ruby"
                    variant="faded"
                    size="sm"
                    label="Cancelar"
                    aria-label={`Cancelar pedido #${activity.id}`}
                    onClick={() => setStopping({ kind: 'activity', activity })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {stopping?.kind === 'answer' && (
        <ConfirmModal
          title={`Encerrar a resposta da ${answerLabel(stopping.answer)}?`}
          description={
            stopping.answer.kind === 'conversation'
              ? 'O agente para agora, nada é enviado, e a conversa passa para as pessoas da caixa.'
              : 'O agente para agora e não responde esta mensagem.'
          }
          confirm="Encerrar"
          onConfirm={async () => {
            const { kind, id } = stopping.answer;
            await http(
              `/agents/live/${kind === 'conversation' ? 'conversations' : 'chats'}/${id}/stop`,
              'POST',
              {},
            );
            reload();
          }}
          onClose={() => setStopping(null)}
        />
      )}
      {stopping?.kind === 'activity' && (
        <ConfirmModal
          title={`Cancelar o pedido #${stopping.activity.id}?`}
          description="O pedido e tudo o que ele delegou param agora. Não dá para retomar."
          confirm="Cancelar pedido"
          onConfirm={async () => {
            await http(`/engine/activities/${stopping.activity.id}/cancel`, 'POST', {});
            reload();
          }}
          onClose={() => setStopping(null)}
        />
      )}
    </SettingsPage>
  );
}
