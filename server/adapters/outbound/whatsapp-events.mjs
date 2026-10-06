// History sync and outbound echoes must never start an event-triggered response loop.
const controlKinds = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'unknown',
]);
/** Persists an upsert batch and returns the newly stored, user-visible messages. */
export function persistLiveMessages(store, sessionId, { messages, type }, onMessage) {
  const visible = [];
  for (const message of messages) {
    const saved = store.message(sessionId, message);
    if (!saved || controlKinds.has(saved.kind)) continue;
    visible.push(saved);
    if (type === 'notify' && !saved.from_me) onMessage?.(sessionId, saved);
  }
  return visible;
}
