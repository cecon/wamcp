import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectGithubModal } from '../../src/agent/settings/github/ConnectGithubModal';
import { GithubSetup } from '../../src/agent/settings/github/GithubSetup';
import { fakeApi } from './fake-api';

const webhook = {
  webhook_url: 'https://wamcp.cappyfy.com/api/github/4/webhook',
  webhook_secret: 'segredo-123',
  events: ['pull_request', 'issues'],
};

describe('GitHub channel', () => {
  it('connects a repository and explains the webhook when the token could not create it', async () => {
    const api = fakeApi({
      'POST /github_channels': {
        ...webhook,
        inbox: { id: 4, name: 'wamcp no GitHub' },
        hook_created: false,
        hook_error: 'O token não tem acesso a isso no GitHub',
      },
    });
    const onConnected = vi.fn(async () => {});
    render(<ConnectGithubModal onClose={vi.fn()} onConnected={onConnected} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nome da caixa'), 'wamcp no GitHub');
    await user.type(screen.getByLabelText('Repositório'), 'cecon/wamcp');
    await user.type(screen.getByLabelText('Token do GitHub'), 'github_pat_x');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));

    expect(await screen.findByText(webhook.webhook_url)).toBeInTheDocument();
    expect(api.called('POST', '/github_channels')[0].body).toEqual({
      name: 'wamcp no GitHub',
      repo: 'cecon/wamcp',
      token: 'github_pat_x',
    });
    expect(screen.getByText(/O token não tem acesso/)).toBeInTheDocument();
    expect(screen.queryByText('segredo-123')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByText('segredo-123')).toBeInTheDocument();
    expect(onConnected).toHaveBeenCalled();
  });

  it('shows the repository and the account that comments', async () => {
    fakeApi({
      'GET /inboxes/4/github': { ...webhook, repo: 'cecon/wamcp', account: 'wamcp-bot', hook_created: true },
      'GET /inboxes/4/github/deliveries': {
        hook_created: true,
        deliveries: [
          { id: 1, event: 'ping', action: null, status: 204, delivered_at: '2026-11-03T10:00:00Z' },
        ],
      },
    });
    render(<GithubSetup inboxId={4} />);
    expect(await screen.findByText('cecon/wamcp')).toBeInTheDocument();
    expect(screen.getByText('@wamcp-bot')).toBeInTheDocument();
    expect(screen.getByText('O webhook foi criado no GitHub pelo app.')).toBeInTheDocument();
    expect(await screen.findByText('ping')).toBeInTheDocument();
    expect(screen.getByText('HTTP 204')).toBeInTheDocument();
  });

  it('creates the missing webhook again and shows why GitHub refused it', async () => {
    let refuse = true;
    const api = fakeApi({
      'GET /inboxes/4/github': { ...webhook, repo: 'cecon/C3Theme', account: 'cecon', hook_created: false },
      'POST /inboxes/4/github/hook': () => ({
        ...webhook,
        repo: 'cecon/C3Theme',
        account: 'cecon',
        hook_created: !refuse,
        hook_error: refuse ? 'O token não tem acesso a isso no GitHub (Resource not accessible)' : null,
      }),
      'GET /inboxes/4/github/deliveries': {
        hook_created: true,
        deliveries: [
          { id: 1, event: 'ping', action: null, status: 204, delivered_at: '2026-11-03T10:00:00Z' },
        ],
      },
    });
    render(<GithubSetup inboxId={4} />);
    const user = userEvent.setup();
    expect(await screen.findByText(/nenhum evento chega a esta caixa/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar webhook' }));
    expect(await screen.findByText(/Resource not accessible/)).toBeInTheDocument();
    refuse = false;
    await user.click(screen.getByRole('button', { name: 'Criar webhook' }));
    expect(await screen.findByText('O webhook foi criado no GitHub pelo app.')).toBeInTheDocument();
    expect(api.called('POST', '/inboxes/4/github/hook')).toHaveLength(2);
  });

  it('shows everything that happened when the channel is created and retries the webhook', async () => {
    const api = fakeApi({
      'POST /github_channels': {
        ...webhook,
        repo: 'cecon/wamcp',
        inbox: { id: 4, name: 'wamcp no GitHub' },
        hook_created: false,
        hook_error: 'O token não tem acesso a isso no GitHub (Resource not accessible)',
        checks: [
          { step: 'token', ok: true, detail: '@wamcp-bot' },
          { step: 'repository', ok: true, detail: 'cecon/wamcp' },
          {
            step: 'webhook',
            ok: false,
            detail: 'O token não tem acesso a isso no GitHub (Resource not accessible)',
          },
        ],
      },
      'POST /inboxes/4/github/hook': () => ({
        ...webhook,
        repo: 'cecon/wamcp',
        hook_created: true,
        hook_error: null,
      }),
      'GET /inboxes/4/github/deliveries': {
        hook_created: true,
        deliveries: [
          { id: 1, event: 'ping', action: null, status: 204, delivered_at: '2026-11-03T10:00:00Z' },
        ],
      },
    });
    const onConnected = vi.fn(async () => {});
    render(<ConnectGithubModal onClose={vi.fn()} onConnected={onConnected} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nome da caixa'), 'wamcp no GitHub');
    await user.type(screen.getByLabelText('Repositório'), 'cecon/wamcp');
    await user.type(screen.getByLabelText('Token do GitHub'), 'github_pat_x');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));

    expect(await screen.findByText(/Token autenticado como @wamcp-bot/)).toBeInTheDocument();
    expect(screen.getByText(/Repositório cecon\/wamcp acessível/)).toBeInTheDocument();
    expect(screen.getByText(/Webhook não criado:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tentar criar webhook de novo' }));
    expect(await screen.findByText('Webhook criado e assinando as entregas')).toBeInTheDocument();
    expect(await screen.findByText('ping')).toBeInTheDocument();
    expect(screen.getByText('HTTP 204')).toBeInTheDocument();
    expect(api.called('POST', '/inboxes/4/github/hook')).toHaveLength(1);
    expect(onConnected).toHaveBeenCalledTimes(2);
  });
});
