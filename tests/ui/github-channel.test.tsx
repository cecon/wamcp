import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectGithubModal } from '../../src/agent/settings/github/ConnectGithubModal';
import { GithubAppPanel } from '../../src/agent/settings/github/GithubAppPanel';
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
    });
    render(<GithubSetup inboxId={4} />);
    expect(await screen.findByText('cecon/wamcp')).toBeInTheDocument();
    expect(screen.getByText('@wamcp-bot')).toBeInTheDocument();
    expect(screen.getByText('O webhook foi criado no GitHub pelo app.')).toBeInTheDocument();
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

  it('starts the GitHub App from a manifest and links to GitHub', async () => {
    const api = fakeApi({
      'GET /github_app': { app: null, repos: [] },
      'POST /github_app': { url: 'https://wamcp.cappyfy.com/api/github/app/new?state=abc' },
    });
    render(<GithubAppPanel />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Organização/), 'minha-empresa');
    await user.click(screen.getByRole('button', { name: 'Criar GitHub App' }));
    const open = await screen.findByRole('link', { name: 'Abrir o GitHub para criar o App' });
    expect(open).toHaveAttribute('href', 'https://wamcp.cappyfy.com/api/github/app/new?state=abc');
    expect(open).toHaveAttribute('target', '_blank');
    expect(api.called('POST', '/github_app')[0].body).toEqual({ owner: 'minha-empresa' });
  });

  it('shows the App, where to install it and the repositories it serves', async () => {
    fakeApi({
      'GET /github_app': {
        app: {
          slug: 'wamcp-agente',
          owner: 'cecon',
          html_url: 'https://github.com/apps/wamcp-agente',
          install_url: 'https://github.com/apps/wamcp-agente/installations/new',
        },
        repos: [{ inbox_id: 2, repo: 'cecon/C3Theme' }],
      },
    });
    render(<GithubAppPanel />);
    expect(await screen.findByText('@wamcp-agente[bot]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Instalar ou escolher/ })).toHaveAttribute(
      'href',
      'https://github.com/apps/wamcp-agente/installations/new',
    );
    expect(screen.getByText('Repositórios: cecon/C3Theme')).toBeInTheDocument();
  });

  it('says when an inbox comes through the GitHub App', async () => {
    fakeApi({
      'GET /inboxes/2/github': {
        ...webhook,
        webhook_secret: '',
        repo: 'cecon/C3Theme',
        account: 'wamcp-agente[bot]',
        hook_created: true,
        via_app: true,
      },
    });
    render(<GithubSetup inboxId={2} />);
    expect(await screen.findByText(/Conectado pelo GitHub App/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar webhook' })).not.toBeInTheDocument();
  });

  it('offers the GitHub App inside an inbox that has no webhook', async () => {
    fakeApi({
      'GET /inboxes/2/github': { ...webhook, repo: 'cecon/C3Theme', account: 'cecon', hook_created: false },
      'GET /github_app': { app: null, repos: [] },
    });
    render(<GithubSetup inboxId={2} />);
    expect(await screen.findByRole('button', { name: 'Criar GitHub App' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar webhook' })).toBeInTheDocument();
  });

  it('replaces the token from the inbox and creates the webhook', async () => {
    const api = fakeApi({
      'GET /inboxes/2/github': { ...webhook, repo: 'cecon/C3Theme', account: 'cecon', hook_created: false },
      'PUT /inboxes/2/github/token': {
        ...webhook,
        repo: 'cecon/C3Theme',
        account: 'cecon',
        hook_created: true,
      },
    });
    render(<GithubSetup inboxId={2} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Novo token do GitHub'), 'github_pat_novo');
    await user.click(screen.getByRole('button', { name: 'Salvar token e criar webhook' }));
    expect(await screen.findByText('O webhook foi criado no GitHub pelo app.')).toBeInTheDocument();
    expect(api.called('PUT', '/inboxes/2/github/token')[0].body).toEqual({ token: 'github_pat_novo' });
  });

  it('removes the GitHub App so it can be created again', async () => {
    let app: unknown = {
      slug: 'jhon-ebmvhk',
      owner: 'cecon',
      html_url: 'https://github.com/apps/jhon-ebmvhk',
      install_url: 'https://github.com/apps/jhon-ebmvhk/installations/new',
    };
    const api = fakeApi({
      'GET /github_app': () => ({ app, repos: [] }),
      'DELETE /github_app': () => {
        app = null;
        return { app: null, repos: [] };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GithubAppPanel />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remover GitHub App' }));
    expect(await screen.findByRole('button', { name: 'Criar GitHub App' })).toBeInTheDocument();
    expect(api.called('DELETE', '/github_app')).toHaveLength(1);
  });
});
