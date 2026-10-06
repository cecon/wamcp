/**
 * In-process event dispatcher (Chatwoot's dispatcher/listeners). Listeners such as SSE, webhooks and
 * notifications subscribe here; a failing listener never breaks the use case that emitted the event.
 */
export function eventBus() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(name, data) {
      for (const listener of listeners) {
        try {
          listener({ event: name, data, at: Date.now() });
        } catch {
          // Listener failures are isolated by design.
        }
      }
    },
  };
}
