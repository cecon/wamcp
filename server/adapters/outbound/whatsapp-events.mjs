// History sync and outbound echoes must never start an event-triggered response loop.
const controlKinds = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'unknown',
]);
export function persistLiveMessages(store, sessionId, { messages, type }, onMessage) {
  for (const message of messages) {
    const saved = store.message(sessionId, message);
    if (type === 'notify' && saved && !saved.from_me && !controlKinds.has(saved.kind)) {
      onMessage?.(sessionId, saved);
    }
  }
}
