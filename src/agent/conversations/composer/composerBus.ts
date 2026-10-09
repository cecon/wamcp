const EVENT = 'wamcp:composer-insert';

/** Asks the reply box of conversation `path` to append `text` (used by the side panel tools). */
export function insertIntoComposer(path: string, text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { path, text } }));
}

/** Subscribes the reply box of `path` to insert requests; returns the unsubscribe function. */
export function onComposerInsert(path: string, listener: (text: string) => void) {
  const handler = (e: Event) => {
    const { detail } = e as CustomEvent<{ path: string; text: string }>;
    if (detail.path === path) listener(detail.text);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
