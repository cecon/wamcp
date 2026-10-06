import {
  EventError,
  ROTATION_WINDOW,
  eventDefinition,
  eventParameters,
  eventOwner,
  subscriptionIdentity,
  messageEvent,
  retryable,
} from '../domain/events.mjs';

export function eventService(repository, webhook, options = {}) {
  const now = options.now ?? repository.now;
  const authorize = options.authorize ?? (() => false);
  const locks = new Map();
  const verificationCache = new Map();
  const disconnected = new Map();
  let timer;
  let running;
  let operations = 0;
  let closed = false;
  const allowed = (owner) => authorize(owner.sessionId, owner.principalId, owner.principalKind) === true;
  const identity = (owner, params) => `sub_${repository.hash(subscriptionIdentity(owner, params))}`;
  function requireAccess(owner) {
    if (closed || !allowed(owner)) throw new EventError('Acesso ao evento revogado ou expirado', -32001);
  }
  function serial(id, operation) {
    if (operations >= 256)
      return Promise.reject(new EventError('Muitas operações de eventos simultâneas', -32000));
    operations++;
    const previous = locks.get(id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    locks.set(id, result);
    void result
      .finally(() => {
        operations--;
        if (locks.get(id) === result) locks.delete(id);
      })
      .catch(() => {});
    return result;
  }
  function prune() {
    repository.prune(now());
    for (const subscription of repository.list()) {
      if (!allowed(subscription)) repository.remove(subscription.id);
    }
    for (const [key, expires] of verificationCache) {
      if (expires <= now()) verificationCache.delete(key);
    }
  }
  async function verify(subscription, force = false) {
    const key = repository.hash(
      JSON.stringify([
        subscription.sessionId,
        subscription.principalKind,
        subscription.principalId,
        subscription.url,
        subscription.secret,
      ]),
    );
    if (!force && verificationCache.get(key) > now()) return;
    try {
      const result = await webhook.verify(subscription);
      if (result === false || result?.accepted === false)
        throw new EventError('Falha ao verificar callback', -32015, 'challenge_failed');
    } catch (error) {
      const reason = error?.data?.reason ?? error?.reason;
      throw new EventError(
        'Falha ao verificar callback',
        -32015,
        ['invalid_url', 'timeout', 'challenge_failed'].includes(reason) ? reason : 'challenge_failed',
      );
    }
    if (verificationCache.size >= 256) verificationCache.delete(verificationCache.keys().next().value);
    verificationCache.set(key, now() + ROTATION_WINDOW);
  }
  async function deliver(item) {
    return serial(item.subscriptionId, async () => {
      const subscription = repository.get(item.subscriptionId);
      if (!subscription || !repository.hasPending(item)) return;
      if (closed || subscription.expires <= now() || !allowed(subscription)) {
        if (!closed) repository.remove(subscription.id);
        return;
      }
      if (subscription.rotateUntil <= now()) {
        delete subscription.previousSecret;
        delete subscription.rotateUntil;
      }
      let response;
      try {
        response = await webhook.deliver(subscription, item.event);
      } catch {
        response = { status: 0 };
      }
      if (!allowed(subscription) || subscription.expires <= now()) {
        repository.remove(subscription.id);
        return;
      }
      const status = response?.status;
      const success = status >= 200 && status < 300;
      const terminal = !retryable(status) || item.attempts >= 7;
      repository.record(
        item,
        status,
        success ? 'delivered' : status === 410 ? 'disabled' : terminal ? 'discarded' : 'retry',
        now(),
      );
      if (status === 410) repository.remove(subscription.id);
      else if (success || terminal) repository.finish(item);
      else repository.retry(item, now() + Math.min(1000 * 2 ** item.attempts, 300000));
    });
  }
  const service = {
    list: () => ({ events: [structuredClone(eventDefinition)] }),
    async subscribe(owner, params) {
      owner = eventOwner(owner);
      const parsed = eventParameters(params);
      const id = identity(owner, parsed);
      const generation = disconnected.get(owner.sessionId);
      return serial(id, async () => {
        requireAccess(owner);
        prune();
        const current = repository.get(id);
        const subscription = {
          ...owner,
          id,
          name: parsed.name,
          args: parsed.args,
          url: parsed.url,
          secret: parsed.secret,
          expires: now() + parsed.ttl,
        };
        if (current?.secret !== parsed.secret && current?.secret) {
          subscription.previousSecret = current.secret;
          subscription.rotateUntil = now() + ROTATION_WINDOW;
        } else if (current?.previousSecret && current.rotateUntil > now()) {
          subscription.previousSecret = current.previousSecret;
          subscription.rotateUntil = current.rotateUntil;
        }
        await verify(subscription, Boolean(current && current.secret !== parsed.secret));
        requireAccess(owner);
        if (disconnected.get(owner.sessionId) !== generation)
          throw new EventError('Sessão desconectada durante a verificação', -32001);
        subscription.expires = now() + parsed.ttl;
        repository.save(subscription);
        return {
          id,
          refreshBefore: new Date(subscription.expires).toISOString(),
          cursor: null,
          truncated: false,
        };
      });
    },
    async unsubscribe(owner, params) {
      owner = eventOwner(owner);
      const parsed = eventParameters(params, false);
      return serial(identity(owner, parsed), () => {
        requireAccess(owner);
        repository.remove(identity(owner, parsed));
        return {};
      });
    },
    publish(sessionId, message) {
      if (closed) return 0;
      const event = messageEvent(sessionId, message, now(), repository.hash);
      if (!event) return 0;
      prune();
      let queued = 0;
      for (const subscription of repository.list(sessionId)) {
        if (
          (!subscription.args.jid || subscription.args.jid === event.data.jid) &&
          repository.enqueue(subscription, event, now())
        )
          queued++;
      }
      return queued;
    },
    flush() {
      if (closed) return Promise.resolve();
      if (running) return running;
      running = (async () => {
        prune();
        const pending = repository.due(now());
        await Promise.all(
          Array.from({ length: Math.min(4, pending.length) }, async () => {
            while (!closed && pending.length) await deliver(pending.shift());
          }),
        );
      })().finally(() => {
        running = undefined;
      });
      return running;
    },
    disconnect(sessionId) {
      disconnected.set(sessionId, (disconnected.get(sessionId) ?? 0) + 1);
      repository.removeSession(sessionId);
    },
    start() {
      if (!timer && !closed) {
        timer = setInterval(() => {
          void service.flush().catch(options.onError ?? (() => {}));
        }, 1000);
        timer.unref?.();
      }
    },
    async close() {
      closed = true;
      clearInterval(timer);
      await Promise.allSettled([running, ...locks.values()]);
      verificationCache.clear();
    },
  };
  return service;
}
