import { invoke } from '@tauri-apps/api/core';

/** Desktop runtime of the Tauri window: tunnel, data folder and the address for the local network. */
export interface RuntimeStatus {
  tunnelConfigured: boolean;
  tunnelRunning: boolean;
  dataDir: string;
  /** e.g. http://192.168.0.10:17382/app/ (null when no network address was found). */
  networkUrl: string | null;
}

/** Native commands exist only inside the Tauri window; browsers on the network never get them. */
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Window event asking the update notice to check now (Configurações → Aplicativo). */
export const CHECK_UPDATES_EVENT = 'wamcp:check-updates';

export const desktop = {
  runtimeStatus: () => invoke<RuntimeStatus>('runtime_status'),
  configureTunnel: (token: string) => invoke<void>('configure_tunnel', { token }),
  autostartStatus: () => invoke<boolean>('autostart_status'),
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
  checkUpdate: () => invoke<{ version: string } | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};

/** Native errors arrive as plain strings. */
export const nativeError = (error: unknown) => (error instanceof Error ? error.message : String(error));
