import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { ApiError, firstRun, formatTime, http, initials, query } from '../../src/agent/api';
import { fakeApi, status, type Route } from './fake-api';
import { admin, workspaceRoutes } from './fixtures';

function firstRunApi(setup: Route, extra: Record<string, Route> = {}) {
  let signedIn = false;
  return fakeApi({
    ...workspaceRoutes(),
    'GET /auth/me': () => {
      if (!signedIn) throw status(401, 'Faça login para continuar');
      return { user: admin, csrf: 'csrf' };
    },
    'GET /api/helpdesk/status': setup,
    'POST /auth/login': () => {
      signedIn = true;
      return { user: admin, csrf: 'csrf-novo' };
    },
    ...extra,
  });
}

async function fillAdmin(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
  await user.type(await screen.findByLabelText('Nome'), 'Admin');
  await user.type(screen.getByLabelText('E-mail'), 'admin@example.com');
  await user.type(screen.getByLabelText('Senha (mínimo 10 caracteres)'), password);
  await user.type(screen.getByLabelText('Confirmar senha'), confirm);
  await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
}

describe('first run on this computer', () => {
  it('creates the first administrator and signs in automatically', async () => {
    const api = firstRunApi(
      { needsBootstrap: true, local: true },
      { 'POST /api/helpdesk/bootstrap': { id: 1 } },
    );
    const user = userEvent.setup();
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Criar administrador' })).toBeInTheDocument();
    await fillAdmin(user, 'curta', 'curta');
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos 10 caracteres');
    await user.clear(screen.getByLabelText('Senha (mínimo 10 caracteres)'));
    await user.clear(screen.getByLabelText('Confirmar senha'));
    await user.clear(screen.getByLabelText('Nome'));
    await user.clear(screen.getByLabelText('E-mail'));
    await fillAdmin(user, 'senha-segura-123', 'senha-diferente-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não conferem.');
    expect(api.called('POST', '/api/helpdesk/bootstrap')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Confirmar senha'));
    await user.type(screen.getByLabelText('Confirmar senha'), 'senha-segura-123');
    await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(api.called('POST', '/api/helpdesk/bootstrap')[0].body).toEqual({
      name: 'Admin',
      email: 'admin@example.com',
      password: 'senha-segura-123',
    });
    expect(api.called('POST', '/auth/login')[0].body).toEqual({
      email: 'admin@example.com',
      password: 'senha-segura-123',
    });
  });

  it('goes back to the usual login when an administrator already exists', async () => {
    firstRunApi(
      { needsBootstrap: true, local: true },
      {
        'POST /api/helpdesk/bootstrap': () => {
          throw status(409, 'Já existe um administrador');
        },
      },
    );
    const user = userEvent.setup();
    render(<AgentApp />);
    await fillAdmin(user, 'senha-segura-123');
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Já existe um administrador. Entre com o e-mail');
  });

  it('shows the server error when the first administrator cannot be created', async () => {
    firstRunApi(
      { needsBootstrap: true, local: true },
      {
        'POST /api/helpdesk/bootstrap': () => {
          throw status(400, 'E-mail inválido');
        },
      },
    );
    const user = userEvent.setup();
    render(<AgentApp />);
    await fillAdmin(user, 'senha-segura-123');
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail inválido');
    expect(screen.getByRole('button', { name: 'Criar administrador' })).toBeEnabled();
  });

  it('falls back to the login form when signing in after the setup fails', async () => {
    fakeApi({
      'GET /auth/me': () => {
        throw status(401, 'Faça login');
      },
      'GET /api/helpdesk/status': { needsBootstrap: true, local: true },
      'POST /api/helpdesk/bootstrap': { id: 1 },
      'POST /auth/login': () => {
        throw status(429, '');
      },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await fillAdmin(user, 'senha-segura-123');
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas');
  });
});

describe('first run from another computer', () => {
  it('asks to open the app on the computer where it is installed', async () => {
    const api = firstRunApi({ needsBootstrap: true, local: false });
    render(<AgentApp />);
    expect(
      await screen.findByText(
        'Abra o WA MCP no computador onde ele está instalado para criar o primeiro administrador.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar administrador' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(api.called('POST', '/api/helpdesk/bootstrap')).toHaveLength(0);
  });

  it('keeps the usual login once an administrator exists or when the status is unavailable', async () => {
    firstRunApi(() => {
      throw status(503, 'indisponível');
    });
    const { unmount } = render(<AgentApp />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    unmount();
    const api = firstRunApi({ needsBootstrap: false, local: true });
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Entrar no Atendimento' })).toBeInTheDocument();
    await waitFor(() => expect(api.called('GET', '/api/helpdesk/status')).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: 'Criar administrador' })).not.toBeInTheDocument();
  });
});

describe('api helpers', () => {
  it('builds queries, formats times and initials', () => {
    expect(query({ a: 1, b: '', c: undefined, d: null, e: 'x y' })).toBe('?a=1&e=x+y');
    expect(query({})).toBe('');
    expect(initials('maria souza lima')).toBe('MS');
    expect(initials(null)).toBe('?');
    expect(formatTime(Math.floor(Date.now() / 1000))).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTime(1700000000)).toMatch(/^\d{2}\/\d{2}$/);
    expect(new ApiError('falhou', 418).status).toBe(418);
  });

  it('falls back to a generic message when the server sends no JSON', async () => {
    globalThis.fetch = async () => new Response('oops', { status: 502 });
    await expect(http('/x')).rejects.toThrow('Não foi possível concluir a operação.');
    await expect(firstRun('/status')).rejects.toThrow('Não foi possível concluir a operação.');
  });

  it('sends first-run calls outside /api/v1', async () => {
    const api = fakeApi({ 'POST /api/helpdesk/bootstrap': { id: 1 } });
    await firstRun('/bootstrap', 'POST', { name: 'A' });
    expect(api.calls[0].path).toBe('/api/helpdesk/bootstrap');
    expect(api.calls[0].headers['X-CSRF-Token']).toBeDefined();
  });
});
