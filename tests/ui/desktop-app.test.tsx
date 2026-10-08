import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { Sidebar } from '../../src/agent/sidebar/Sidebar';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import { FIRST_CHECK_MS, UpdateNotice } from '../../src/agent/desktop/UpdateNotice';
import type { RuntimeStatus } from '../../src/agent/desktop/tauri';
import { admin, inbox, labels, team } from './fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const catalog = { inboxes: [inbox], agents: [admin], teams: [team], labels };
let runtime: RuntimeStatus;
let autostart: boolean;
let commands: Record<string, (args?: Record<string, unknown>) => unknown>;
let downloading: EventCallback<string> | undefined;

function enterTauri() {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
}

beforeEach(() => {
  runtime = {
    tunnelConfigured: true,
    tunnelRunning: false,
    dataDir: 'C:\\Users\\ana\\AppData\\Local\\com.cappyfy.wamcp',
    networkUrl: 'http://192.168.0.10:17382/app/',
    updatesEnabled: true,
  };
  autostart = false;
  commands = {
    runtime_status: () => runtime,
    autostart_status: () => autostart,
    set_autostart: (args) => {
      autostart = Boolean(args?.enabled);
    },
    configure_tunnel: () => {
      runtime = { ...runtime, tunnelRunning: true };
    },
    check_update: () => null,
    install_update: () => undefined,
  };
  invokeMock.mockImplementation(async (command: string, args?: unknown) =>
    commands[command](args as Record<string, unknown>),
  );
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    downloading = handler as EventCallback<string>;
    return () => {};
  });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const renderSettings = (section: 'app' | 'connections') =>
  render(
    <SettingsRouter
      route={{ page: 'settings', section }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
const renderSidebar = () =>
  render(
    <Sidebar
      user={admin}
      catalog={catalog}
      route={{ page: 'settings', section: 'connections' }}
      unread={0}
      online
      onNavigate={vi.fn()}
      onAvailability={vi.fn()}
      onLogout={vi.fn()}
    />,
  );

describe('outside the desktop app', () => {
  it('hides the Aplicativo page and never calls native commands', async () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Conexões WhatsApp' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Aplicativo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minhas sessões' })).not.toBeInTheDocument();
  });

  it('answers a direct link with no access', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSettings('app');
    render(<UpdateNotice />);
    expect(screen.getByText('Você não tem acesso a esta página')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS * 2);
    expect(invokeMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('Configurações → Aplicativo', () => {
  it('appears in the sidebar inside the desktop window', () => {
    enterTauri();
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Aplicativo' })).toBeInTheDocument();
  });

  it('toggles start with Windows, shares the network address and saves the tunnel token', async () => {
    enterTauri();
    const user = userEvent.setup();
    renderSettings('app');
    const address = await screen.findByLabelText('Endereço na rede local');
    expect(address).toHaveValue('http://192.168.0.10:17382/app/');
    expect(
      screen.getByText(
        'Outros computadores da rede abrem este endereço no navegador e entram com login e senha.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar endereço na rede' }));
    expect(await navigator.clipboard.readText()).toBe('http://192.168.0.10:17382/app/');
    expect(screen.getByLabelText('Pasta de dados')).toHaveValue(runtime.dataDir);
    expect(screen.getByText('Versão instalada: 0.0.0-test')).toBeInTheDocument();
    expect(screen.getByTestId('tunnel-status')).toHaveTextContent('Túnel configurado, conector parado');

    const toggle = screen.getByRole('switch', { name: 'Iniciar com o Windows' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(invokeMock).toHaveBeenCalledWith('set_autostart', { enabled: true });

    expect(screen.getByRole('button', { name: 'Salvar e conectar' })).toBeDisabled();
    await user.type(screen.getByLabelText('Token do túnel'), ' eyJ-token ');
    await user.click(screen.getByRole('button', { name: 'Salvar e conectar' }));
    expect(await screen.findByText('Túnel configurado e iniciado.')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('configure_tunnel', { token: 'eyJ-token' });
    expect(screen.getByTestId('tunnel-status')).toHaveTextContent('Conector em execução');
    expect(screen.getByLabelText('Token do túnel')).toHaveValue('');
  });

  it('explains missing network and tunnel, and shows native errors', async () => {
    enterTauri();
    runtime = { ...runtime, tunnelConfigured: false, networkUrl: null };
    commands.set_autostart = () => {
      throw 'Não foi possível atualizar o início automático.';
    };
    commands.configure_tunnel = () => {
      throw new Error('Token inválido');
    };
    const user = userEvent.setup();
    renderSettings('app');
    expect(await screen.findByText('Nenhuma rede local detectada neste computador.')).toBeInTheDocument();
    expect(screen.getByTestId('tunnel-status')).toHaveTextContent('Túnel não configurado');
    await user.click(screen.getByRole('switch', { name: 'Iniciar com o Windows' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível atualizar o início');
    await user.type(screen.getByLabelText('Token do túnel'), 'x');
    await user.click(screen.getByRole('button', { name: 'Salvar e conectar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Token inválido'));
  });

  it('hides update checks in development builds', async () => {
    enterTauri();
    runtime = { ...runtime, updatesEnabled: false };
    renderSettings('app');
    expect(await screen.findByText('Modo de desenvolvimento: atualizações desativadas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verificar atualizações' })).not.toBeInTheDocument();
  });

  it('reports a runtime that cannot be read', async () => {
    enterTauri();
    commands.runtime_status = () => {
      throw 'Falha no runtime';
    };
    renderSettings('app');
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha no runtime');
  });
});

describe('desktop updates', () => {
  it('prepares the update in the background and installs only when asked', async () => {
    enterTauri();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: () => void = () => {};
    commands.check_update = () => ({ version: '26.10.99' });
    commands.install_update = () => new Promise<void>((resolve) => (release = resolve));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<UpdateNotice />);
    await waitFor(() => expect(downloading).toBeDefined());
    downloading!({ event: 'update-downloading', id: 1, payload: '26.10.99' });
    expect(await screen.findByText('Baixando a versão 26.10.99 em segundo plano…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(await screen.findByText('WA MCP 26.10.99 disponível')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('install_update');
    await user.click(screen.getByRole('button', { name: 'Reiniciar e atualizar' }));
    expect(screen.getByRole('button', { name: 'Instalando…' })).toBeDisabled();
    expect(invokeMock).toHaveBeenCalledWith('install_update');
    release();
    vi.useRealTimers();
  });

  it('checks on demand from the settings page and reports failures without offering installation', async () => {
    enterTauri();
    const user = userEvent.setup();
    renderSettings('app');
    render(<UpdateNotice />);
    await user.click(await screen.findByRole('button', { name: 'Verificar atualizações' }));
    expect(await screen.findByText('Você está na versão mais recente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar aviso de atualização' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    commands.check_update = () => {
      throw 'Falha ao validar assinatura. A versão atual foi mantida.';
    };
    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    expect(await screen.findByText(/Falha ao validar assinatura/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar e atualizar' })).not.toBeInTheDocument();
  });

  it('keeps the current version when the installation fails', async () => {
    enterTauri();
    commands.check_update = () => ({ version: '27.1.0' });
    commands.install_update = () => {
      throw 'Falha na instalação. Verifique novamente para tentar outra vez.';
    };
    const user = userEvent.setup();
    render(<UpdateNotice />);
    window.dispatchEvent(new Event('wamcp:check-updates'));
    await user.click(await screen.findByRole('button', { name: 'Reiniciar e atualizar' }));
    expect(await screen.findByText(/Falha na instalação/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar e atualizar' })).not.toBeInTheDocument();
  });
});
