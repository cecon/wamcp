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
    });
    render(<GithubSetup inboxId={4} />);
    expect(await screen.findByText('cecon/wamcp')).toBeInTheDocument();
    expect(screen.getByText('@wamcp-bot')).toBeInTheDocument();
    expect(screen.getByText('O webhook foi criado no GitHub pelo app.')).toBeInTheDocument();
  });
});
