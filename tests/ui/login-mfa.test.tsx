import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { fakeApi, status } from './fake-api';
import { admin, workspaceRoutes } from './fixtures';

function loginRoutes(mfa: (code: string) => unknown) {
  return fakeApi({
    ...workspaceRoutes(),
    'GET /auth/me': () => {
      throw status(401, 'Faça login para continuar');
    },
    'POST /auth/login': (body) => {
      if ((body as { password: string }).password === 'muitas') throw status(429, '');
      return { mfa_required: true, mfa_token: 'desafio-1' };
    },
    'POST /auth/mfa': (body) => mfa((body as { code: string }).code),
  });
}

async function signIn(user: ReturnType<typeof userEvent.setup>, password = 'senha-segura-123') {
  await user.type(await screen.findByLabelText('E-mail'), 'admin@example.com');
  await user.type(screen.getByLabelText('Senha'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('two-step login', () => {
  it('asks for the code, handles invalid codes and rate limits, then signs in with a backup code', async () => {
    const api = loginRoutes((code) => {
      if (code === '000000') throw status(401, 'Código inválido');
      if (code === '111111') throw status(429, '');
      return { user: admin, csrf: 'csrf-mfa' };
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await signIn(user);
    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    const code = screen.getByLabelText('Código de verificação');
    expect(screen.getByRole('button', { name: 'Verificar' })).toBeDisabled();
    await user.type(code, '000000{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(code).toHaveValue('');
    await user.type(code, '111111{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas');
    await user.type(code, ' abcd0-ef012 ');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(api.called('POST', '/auth/mfa').at(-1)!.body).toEqual({
      mfa_token: 'desafio-1',
      code: 'abcd0-ef012',
    });
  });

  it('returns to the password step when the challenge expires or is cancelled', async () => {
    loginRoutes(() => {
      throw status(401, 'Verificação expirada; entre novamente');
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await signIn(user);
    await user.type(await screen.findByLabelText('Código de verificação'), '123456{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Verificação expirada; entre novamente');
    expect(screen.getByLabelText('Senha')).toHaveValue('');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar e voltar para o login' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains rate-limited password attempts', async () => {
    loginRoutes(() => ({}));
    const user = userEvent.setup();
    render(<AgentApp />);
    await signIn(user, 'muitas');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    );
  });
});
