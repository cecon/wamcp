import { useState } from 'react';
import { http } from '../../api';
import type { Inbox } from '../../types';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { WebhookInstructions, type GithubWebhook } from './WebhookInstructions';

interface Connection extends GithubWebhook {
  inbox: Inbox;
  hook_error: string | null;
}

interface Props {
  onClose: () => void;
  onConnected: () => Promise<void>;
}

/** Connects a GitHub repository as an inbox: its events become conversations the inbox's agent answers. */
export function ConnectGithubModal({ onClose, onConnected }: Props) {
  const [name, setName] = useState(''),
    [repo, setRepo] = useState(''),
    [token, setToken] = useState(''),
    [done, setDone] = useState<Connection | null>(null);
  const { error, busy, run } = useAction();

  if (done)
    return (
      <Modal title="Repositório conectado" onClose={onClose}>
        {done.hook_created ? (
          <p className="text-sm text-n-slate-12">
            Criamos o webhook em <strong>{done.repo ?? repo}</strong>. Pull requests, issues, falhas de
            Actions e pushes na main já chegam na caixa <strong>{done.inbox.name}</strong>. Escolha nela o
            agente de IA que vai se posicionar.
          </p>
        ) : (
          <WebhookInstructions webhook={done} reason={done.hook_error} />
        )}
        <div className="mt-6 flex justify-end">
          <button type="button" className="text-sm font-medium text-n-blue-11" onClick={onClose}>
            Fechar
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Conectar repositório do GitHub"
      description="Os eventos do repositório viram conversas, e o agente de IA da caixa comenta nos PRs e issues."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const connection = await http<Connection>('/github_channels', 'POST', { name, repo, token });
            setDone({ ...connection, repo });
            await onConnected();
          });
        }}
      >
        <label>
          <span className="field-label">Nome da caixa</span>
          <input
            className="field"
            required
            maxLength={80}
            placeholder="Ex.: wamcp no GitHub"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Repositório</span>
          <input
            className="field"
            required
            placeholder="dono/repositorio"
            pattern="[\w.\-]+/[\w.\-]+"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        <div>
          <label>
            <span className="field-label">Token do GitHub</span>
            <input
              className="field"
              required
              type="password"
              autoComplete="off"
              aria-describedby="github-token-hint"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p id="github-token-hint" className="mt-1 text-xs text-n-slate-11">
            Token fine-grained só deste repositório, com permissão de escrita em Issues e Pull requests (para
            comentar) e em Webhooks (para criarmos o webhook). Ele fica guardado criptografado.
          </p>
        </div>
        <ModalFooter busy={busy} submit="Conectar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
