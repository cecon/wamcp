import { useEffect, useRef } from 'react';

/** A global shortcut: `keys` like "alt+j", "mod+k" (Ctrl or ⌘), "?" or "/". */
export interface Hotkey {
  keys: string;
  run: () => void;
}

/** Typing in a field (or using a dialog) must not trigger global shortcuts. */
function ignored(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    Boolean(el.closest('[role="dialog"]'))
  );
}

/** Letters match the physical key (Alt+J types "∆" on macOS); other keys match the character. */
export function matches(e: KeyboardEvent, keys: string) {
  const parts = keys.toLowerCase().split('+');
  const key = parts.pop() || '';
  if (parts.includes('mod') !== (e.ctrlKey || e.metaKey) || parts.includes('alt') !== e.altKey) return false;
  return /^[a-z]$/.test(key) ? e.code === `Key${key.toUpperCase()}` : e.key.toLowerCase() === key;
}

/** Listens for the shortcuts on the window while mounted; the latest handlers are always used. */
export function useHotkeys(bindings: Hotkey[]) {
  const current = useRef(bindings);
  useEffect(() => {
    current.current = bindings;
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ignored(e.target)) return;
      const hit = current.current.find((b) => matches(e, b.keys));
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

/** Clicks or focuses the element tagged with `data-shortcut="<name>"` (labels picker, composer). */
export function triggerElement(name: string, action: 'click' | 'focus') {
  const el = document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`);
  if (action === 'click') el?.click();
  else el?.focus();
  return Boolean(el);
}
