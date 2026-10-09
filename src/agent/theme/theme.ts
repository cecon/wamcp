import { useEffect, useSyncExternalStore } from 'react';

/** Appearance (Chatwoot: light, dark or follow the system), kept per browser in localStorage. */
export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_LABEL: Record<ThemeMode, string> = { light: 'Claro', dark: 'Escuro', system: 'Sistema' };

const KEY = 'wamcp.agent.theme';
const listeners = new Set<() => void>();

export function getTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page reloads.
  }
  applyTheme(mode);
  for (const listener of listeners) listener();
}

const darkQuery = () =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** Sets `data-theme` on <html>; the CSS swaps the color tokens for the dark palette. */
export function applyTheme(mode = getTheme()) {
  const dark = mode === 'dark' || (mode === 'system' && Boolean(darkQuery()?.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current theme and its setter; while on "Sistema" it follows changes of the OS preference. */
export function useTheme() {
  const mode = useSyncExternalStore(subscribe, getTheme);
  useEffect(() => {
    applyTheme(mode);
    const query = mode === 'system' ? darkQuery() : null;
    const follow = () => applyTheme('system');
    query?.addEventListener('change', follow);
    return () => query?.removeEventListener('change', follow);
  }, [mode]);
  return [mode, setTheme] as const;
}
