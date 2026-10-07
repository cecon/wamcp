import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { SNOOZE_OPTIONS, notificationText } from '../../src/agent/notifications/notificationText';
import { alertNotification, loadAlertPrefs } from '../../src/agent/notifications/browserAlerts';
import type { AppNotification } from '../../src/agent/types';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { workspaceRoutes } from './fixtures';

const note = (id: number, fields: Partial<AppNotification> = {}): AppNotification => ({
  id,
  notification_type: 'conversation_mention',
  display_id: 7,
  contact_name: 'João Cliente',
  actor_name: 'Maria Souza',
  read_at: null,
  created_at: Math.floor(Date.now() / 1000),
  ...fields,
});

function feed(initial: AppNotification[]) {
  let items = initial;
  const unread = () => ({ unread: items.filter((n) => !n.read_at).length });
  const update = (id: number, fields: Partial<AppNotification>) => {
    items = items.map((n) => (n.id === id ? { ...n, ...fields } : n));
    return unread();
  };
  const routes = {
    'GET /notifications': () => ({ items, ...unread() }),
    'PATCH /notifications/1': () => update(1, { read_at: 9 }),
    'POST /notifications/1/unread': () => update(1, { read_at: null }),
    'POST /notifications/2/snooze': () => {
      items = items.filter((n) => n.id !== 2);
      return unread();
    },
    'DELETE /notifications/3': () => {
      throw status(404, 'Notificação não encontrada');
    },
    'POST /notifications/read_all': () => {
      items = items.map((n) => ({ ...n, read_at: 9 }));
      return unread();
    },
    'POST /notifications/destroy_all': () => {
      items = [];
      return { unread: 0 };
    },
  };
  return routes;
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Notificações/ }));
  return screen.getByRole('dialog', { name: 'Painel de notificações' });
}

describe('notification texts and snooze times', () => {
  it('describes every notification type in pt-BR', () => {
    const texts = [
      'conversation_creation',
      'conversation_assignment',
      'assigned_conversation_new_message',
      'conversation_mention',
      'participating_conversation_new_message',
    ].map((type) => notificationText(note(1, { notification_type: type, actor_name: null })));
    expect(texts).toEqual([
      'Nova conversa #7',
      'Sistema atribuiu a você a conversa #7',
      'Nova mensagem em #7',
      'Alguém mencionou você na conversa #7',
      'Nova mensagem na conversa #7 em que você participa',
    ]);
  });

  it('snoozes for one hour, until tomorrow 9:00 or next Monday 9:00', () => {
    const wednesday = new Date(2026, 9, 7, 15, 30);
    const [hour, tomorrow, nextWeek] = SNOOZE_OPTIONS.map((o) => new Date(o.until(wednesday) * 1000));
    expect(hour.getTime() - wednesday.getTime()).toBe(3600 * 1000);
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([8, 9, 0]);
    expect([nextWeek.getDay(), nextWeek.getDate(), nextWeek.getHours()]).toEqual([1, 12, 9]);
    const monday = new Date(2026, 9, 12, 8, 0);
    expect(new Date(SNOOZE_OPTIONS[2].until(monday) * 1000).getDate()).toBe(19);
  });
});

describe('notification bell', () => {
  it('lists notifications in the panel and runs the item and bulk actions', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      ...feed([
        note(1),
        note(2, { notification_type: 'conversation_assignment', read_at: 5 }),
        note(3, { notification_type: 'participating_conversation_new_message', display_id: 8 }),
      ]),
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    const panel = await openPanel(user);
    expect(await within(panel).findByText('Maria Souza mencionou você na conversa #7')).toBeInTheDocument();
    expect(within(panel).getByText('Nova mensagem na conversa #8 em que você participa')).toBeInTheDocument();

    const menu = async (text: string, item: string) => {
      await user.click(within(panel).getByRole('button', { name: `Ações: ${text}` }));
      await user.click(screen.getByRole('menuitem', { name: item }));
    };
    await menu('Maria Souza mencionou você na conversa #7', 'Marcar como lida');
    await waitFor(() => expect(api.called('PATCH', '/notifications/1')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notificações (1 não lidas)' })).toBeInTheDocument(),
    );
    await menu('Maria Souza mencionou você na conversa #7', 'Marcar como não lida');
    await waitFor(() => expect(api.called('POST', '/notifications/1/unread')).toHaveLength(1));
    await menu('Maria Souza atribuiu a você a conversa #7', 'Adiar até amanhã às 9h');
    await waitFor(() =>
      expect(within(panel).queryByText('Maria Souza atribuiu a você a conversa #7')).not.toBeInTheDocument(),
    );
    const snoozed = api.called('POST', '/notifications/2/snooze')[0].body as { snoozed_until: number };
    expect(snoozed.snoozed_until).toBeGreaterThan(Date.now() / 1000);
    await menu('Nova mensagem na conversa #8 em que você participa', 'Excluir');
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Notificação não encontrada');

    FakeEventSource.emit('notification.created', note(4));
    await waitFor(() => expect(api.called('GET', '/notifications').length).toBeGreaterThan(4));
    await user.click(within(panel).getByRole('button', { name: 'Marcar tudo como lido' }));
    await waitFor(() => expect(api.called('POST', '/notifications/read_all')).toHaveLength(1));
    await user.click(within(panel).getByRole('button', { name: 'Excluir todas' }));
    expect(await within(panel).findByText('Nenhuma notificação por aqui.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Excluir todas' })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Fechar notificações' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the conversation from the panel and closes on Escape or outside clicks', async () => {
    const api = fakeApi({ ...workspaceRoutes(), ...feed([note(1)]) });
    const user = userEvent.setup();
    render(<AgentApp />);
    await openPanel(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openPanel(user);
    await user.click(screen.getByRole('heading', { name: 'Conversas' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const panel = await openPanel(user);
    await user.click(await within(panel).findByText('Maria Souza mencionou você na conversa #7'));
    await waitFor(() => expect(api.called('PATCH', '/notifications/1')).toHaveLength(1));
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Painel de notificações' })).not.toBeInTheDocument();
  });
});

describe('browser alerts', () => {
  it('plays a chime and shows a desktop notification for new notifications when enabled', async () => {
    const shown: { title: string; body?: string }[] = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title: string, options?: { body?: string }) {
        shown.push({ title, body: options?.body });
      }
    }
    const started = vi.fn();
    class FakeAudio {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return { frequency: { value: 0 }, connect: (n: unknown) => n, start: started, stop: vi.fn() };
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: (n: unknown) => n,
        };
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', FakeAudio);
    localStorage.setItem('wamcp.agent.alerts', JSON.stringify({ desktop: true, sound: true }));
    fakeApi(workspaceRoutes());
    render(<AgentApp />);
    await screen.findByRole('button', { name: 'Notificações (3 não lidas)' });
    FakeEventSource.emit('notification.created', note(9));
    expect(await screen.findByRole('button', { name: 'Notificações (4 não lidas)' })).toBeInTheDocument();
    expect(shown).toEqual([{ title: 'WA MCP', body: 'Maria Souza mencionou você na conversa #7' }]);
    expect(started).toHaveBeenCalledTimes(2);

    FakeNotification.permission = 'denied';
    alertNotification(note(10), { desktop: true, sound: false });
    expect(shown).toHaveLength(1);
  });

  it('falls back to no alerts when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadAlertPrefs()).toEqual({ desktop: false, sound: false });
    expect(() => alertNotification(note(1))).not.toThrow();
  });
});
