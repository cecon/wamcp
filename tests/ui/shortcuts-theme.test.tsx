import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { matches } from '../../src/agent/shortcuts/hotkeys';
import { applyTheme, getTheme, setTheme } from '../../src/agent/theme/theme';
import { fakeApi } from './fake-api';
import { conversation, message, workspaceRoutes } from './fixtures';

const second = { ...conversation, id: 101, display_id: 8, contact_name: 'Bia Lima', labels: [] };
const routes = () => ({
  ...workspaceRoutes(),
  'GET /conversations': [conversation, second],
  'GET /conversations/8': second,
  'GET /conversations/8/messages': [message(5, { conversation_id: 101, content: 'Mensagem da Bia' })],
  'POST /conversations/7/toggle_status': (body: unknown) => ({ ...conversation, ...(body as object) }),
  'POST /conversations/7/assignments': (body: unknown) => ({ ...conversation, ...(body as object) }),
  'POST /conversations/7/messages': (body: unknown) => message(9, { ...(body as object) }),
});

async function openApp() {
  const api = fakeApi(routes());
  const user = userEvent.setup();
  render(<AgentApp />);
  await screen.findByRole('heading', { name: 'Conversas' });
  await screen.findByText('Bia Lima');
  return { api, user };
}

describe('keyboard shortcuts', () => {
  it('opens the help with ? or the profile menu and closes it with Esc', async () => {
    const { user } = await openApp();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeInTheDocument();
    expect(screen.getByText('Próxima conversa')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Atalhos de teclado' }));
    expect(screen.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves between conversations and acts on the open one', async () => {
    const { api, user } = await openApp();
    await user.keyboard('{Alt>}j{/Alt}');
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    await user.keyboard('{Alt>}j{/Alt}');
    expect(await screen.findByText('Mensagem da Bia')).toBeInTheDocument();
    await user.keyboard('{Alt>}k{/Alt}');
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();

    // Shortcuts are ignored while typing, but "/" from elsewhere focuses the composer.
    const composer = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.click(composer);
    await user.keyboard('{Alt>}j{/Alt}');
    expect(screen.queryByText('Mensagem da Bia')).not.toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'Conversas' }));
    await user.keyboard('/');
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue('');
    await user.type(composer, 'Olá{Control>}{Enter}{/Control}');
    await waitFor(() => expect(api.called('POST', '/conversations/7/messages')).toHaveLength(1));
    expect(api.called('POST', '/conversations/7/messages')[0].body).toMatchObject({ content: 'Olá' });

    await user.click(screen.getByRole('heading', { name: 'Conversas' }));
    await user.keyboard('{Alt>}e{/Alt}');
    await waitFor(() => expect(api.called('POST', '/conversations/7/toggle_status')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
    await user.keyboard('{Alt>}e{/Alt}{Alt>}o{/Alt}');
    await waitFor(() => expect(api.called('POST', '/conversations/7/toggle_status')).toHaveLength(2));
    expect(api.called('POST', '/conversations/7/toggle_status').map((c) => c.body)).toEqual([
      { status: 'resolved' },
      { status: 'open' },
    ]);
    await user.keyboard('{Alt>}a{/Alt}');
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/assignments')[0].body).toEqual({ assignee_id: 1 }),
    );
    await user.keyboard('{Alt>}l{/Alt}');
    expect(await screen.findByRole('menuitem', { name: 'financeiro' })).toBeInTheDocument();
  });

  it('reopens the contact panel to pick labels and opens search with Ctrl+K', async () => {
    const { user } = await openApp();
    await user.keyboard('{Alt>}j{/Alt}');
    await screen.findByText('Alguém aí?');
    await user.click(screen.getByRole('button', { name: 'Ocultar painel do contato' }));
    await user.keyboard('{Alt>}l{/Alt}');
    expect(await screen.findByRole('menuitem', { name: 'financeiro' })).toBeInTheDocument();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('heading', { name: 'Pesquisar' })).toBeInTheDocument();
  });

  it('matches key combinations', () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(matches(key({ key: '∆', code: 'KeyJ', altKey: true }), 'alt+j')).toBe(true);
    expect(matches(key({ key: 'j', code: 'KeyJ' }), 'alt+j')).toBe(false);
    expect(matches(key({ key: 'k', code: 'KeyK', metaKey: true }), 'mod+k')).toBe(true);
    expect(matches(key({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }), 'mod+k')).toBe(false);
    expect(matches(key({ key: '?', shiftKey: true }), '?')).toBe(true);
  });
});

describe('theme', () => {
  it('switches between light, dark and system from the profile menu', async () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => (listener = fn),
      removeEventListener: vi.fn(),
    };
    // jsdom has no matchMedia: install one for this test and remove it afterwards.
    window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
    const { user } = await openApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('wamcp.agent.theme')).toBe('light');
    await user.click(screen.getByRole('menuitem', { name: 'Escuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('menuitem', { name: 'Escuro' })).toHaveClass('bg-n-alpha-2');
    await user.click(screen.getByRole('menuitem', { name: 'Sistema' }));
    media.matches = false;
    listener?.();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getTheme()).toBe('system');
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('survives blocked storage and browsers without matchMedia', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getTheme()).toBe('system');
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
