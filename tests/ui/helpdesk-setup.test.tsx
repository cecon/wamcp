import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpdeskSetup } from '../../src/components/HelpdeskSetup';
import { ApiError, formatTime, initials, query } from '../../src/agent/api';
import { fakeApi, status } from './fake-api';

describe('desktop helpdesk setup', () => {
  it('creates the first administrator and then shows the agent address', async () => {
    let created = false;
    const api = fakeApi({
      'GET /api/helpdesk/status': () => ({
        needsBootstrap: !created,
        webUrl: 'https://wamcp.cappyfy.com/app/',
      }),
      'POST /api/helpdesk/bootstrap': (body) => {
        if ((body as { email: string }).email === 'bad@example.com') throw status(409, 'já existe');
        created = true;
        return { id: 1 };
      },
    });
    const user = userEvent.setup();
    render(<HelpdeskSetup />);
    await user.type(await screen.findByLabelText('Nome'), 'Admin');
    await user.type(screen.getByLabelText('E-mail'), 'bad@example.com');
    await user.type(screen.getByLabelText(/Senha/), 'senha-segura-123');
    await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar o administrador');

    await user.clear(screen.getByLabelText('E-mail'));
    await user.type(screen.getByLabelText('E-mail'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
    expect(await screen.findByText('https://wamcp.cappyfy.com/app/')).toBeInTheDocument();
    expect(api.called('POST', '/api/helpdesk/bootstrap').at(-1)!.body).toEqual({
      name: 'Admin',
      email: 'admin@example.com',
      password: 'senha-segura-123',
    });
  });

  it('reports when the local service is unreachable', async () => {
    fakeApi({
      'GET /api/helpdesk/status': () => {
        throw status(401, 'x');
      },
    });
    render(<HelpdeskSetup />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/token administrativo/));
  });
});

describe('agent api helpers', () => {
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
    const { http } = await import('../../src/agent/api');
    globalThis.fetch = async () => new Response('oops', { status: 502 });
    await expect(http('/x')).rejects.toThrow('Não foi possível concluir a operação.');
  });
});
