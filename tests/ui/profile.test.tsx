import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { ProfilePage } from '../../src/agent/profile/ProfilePage';
import { describeUserAgent, formatDateTime } from '../../src/agent/profile/browser';
import { fakeApi, status, type Route } from './fake-api';
import { admin, maria, workspaceRoutes } from './fixtures';

const FLAGS = {
  conversation_creation: false,
  conversation_assignment: true,
  conversation_mention: true,
  assigned_conversation_new_message: true,
  participating_conversation_new_message: true,
};
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const sessions = [
  {
    id: 'a'.repeat(64),
    created: '2026-10-01T12:00:00Z',
    expires: '',
    last_seen: null,
    user_agent: CHROME,
    current: true,
  },
  {
    id: 'b'.repeat(64),
    created: '2026-10-02T12:00:00Z',
    expires: '',
    last_seen: '2026-10-05T08:00:00Z',
    user_agent: FIREFOX,
    current: false,
  },
];

function profileRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    'GET /notification_settings': { flags: FLAGS },
    'GET /profile/mfa': { enabled: false },
    'GET /profile/sessions': sessions,
    ...extra,
  };
}
const renderProfile = () => {
  render(<ProfilePage user={admin} />);
  return userEvent.setup();
};

describe('profile helpers', () => {
  it('labels browsers and formats dates', () => {
    expect(describeUserAgent(CHROME)).toBe('Chrome no Windows');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1')).toBe('Safari no iOS');
    expect(describeUserAgent('curl/8.0')).toBe('Navegador');
    expect(describeUserAgent(null)).toBe('Navegador desconhecido');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('ontem')).toBe('ontem');
    expect(formatDateTime(0)).toMatch(/1969|1970/);
  });
});

describe('profile settings', () => {
  it('opens from the profile menu, and agents reach their macros there', async () => {
    fakeApi({ ...workspaceRoutes(maria), ...profileRoutes(), 'GET /macros': [] });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Configurações do perfil' }));
    expect(await screen.findByRole('heading', { name: 'Configurações do perfil' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Macros' }));
    expect(await screen.findByRole('heading', { name: 'Macros' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma macro encontrada.')).toBeInTheDocument();
  });

  it('toggles notification types and this browser alerts', async () => {
    let permission = 'denied';
    const requestPermission = vi.fn(async () => permission);
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    const api = fakeApi(
      profileRoutes({
        'PATCH /notification_settings': (body) => {
          const flags = (body as { flags: Record<string, boolean> }).flags;
          if ('conversation_mention' in flags) throw status(422, 'Tipo de notificação inválido');
          return { flags: { ...FLAGS, ...flags } };
        },
      }),
    );
    const user = renderProfile();
    const created = await screen.findByRole('switch', { name: 'Uma nova conversa foi criada' });
    await waitFor(() => expect(created).not.toBeChecked());
    await user.click(created);
    await waitFor(() => expect(created).toBeChecked());
    expect(api.called('PATCH', '/notification_settings')[0].body).toEqual({
      flags: { conversation_creation: true },
    });
    await user.click(screen.getByRole('switch', { name: 'Você foi mencionado em uma conversa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo de notificação inválido');

    const desktop = screen.getByRole('switch', { name: 'Notificações na área de trabalho' });
    await user.click(desktop);
    expect(await screen.findByRole('status')).toHaveTextContent('Ative as notificações para este site');
    expect(desktop).not.toBeChecked();
    permission = 'granted';
    await user.click(desktop);
    await waitFor(() => expect(desktop).toBeChecked());
    await user.click(screen.getByRole('switch', { name: 'Alerta sonoro' }));
    expect(JSON.parse(localStorage.getItem('wamcp.agent.alerts')!)).toEqual({ desktop: true, sound: true });
    await user.click(desktop);
    expect(desktop).not.toBeChecked();
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it('lists active sessions and revokes one or all the others', async () => {
    let calls = 0;
    const api = fakeApi(
      profileRoutes({
        [`DELETE /profile/sessions/${'b'.repeat(64)}`]: { ok: true },
        'DELETE /profile/sessions': () => {
          if (++calls === 1) throw status(500, 'Falha ao encerrar');
          return { ok: true };
        },
      }),
    );
    const user = renderProfile();
    const list = await screen.findByRole('list', { name: 'Sessões ativas' });
    expect(await within(list).findByText('Chrome no Windows')).toBeInTheDocument();
    expect(within(list).getByText('Esta sessão')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Encerrar sessão Firefox no Linux' }));
    await waitFor(() => expect(api.called('DELETE', `/profile/sessions/${'b'.repeat(64)}`)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Encerrar outras sessões' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao encerrar');
    await user.click(screen.getByRole('button', { name: 'Encerrar outras sessões' }));
    await waitFor(() => expect(api.called('DELETE', '/profile/sessions')).toHaveLength(2));
    expect(api.called('GET', '/profile/sessions').length).toBeGreaterThanOrEqual(3);
  });
});
