import { usersStore } from './adapters/outbound/sqlite/users-store.mjs';
import { helpdeskStore } from './adapters/outbound/sqlite/helpdesk-store.mjs';
import { passwordHasher } from './adapters/outbound/password.mjs';
import { webhookSender } from './adapters/outbound/webhook-sender.mjs';
import { eventBus } from './application/events.mjs';
import { accountService } from './application/accounts.mjs';
import { helpdeskService } from './application/helpdesk.mjs';
import { catalogService } from './application/catalog.mjs';
import { notificationService } from './application/notifications.mjs';
import { realtimeService } from './application/realtime.mjs';
import { webhookService } from './application/webhooks.mjs';
import { automationService } from './application/automations.mjs';
import { autoReplyService } from './application/auto-replies.mjs';
import { reportService } from './application/reports.mjs';

/**
 * Composition root of the helpdesk: wires SQLite stores, the WhatsApp port and the event listeners.
 * Shared by the server entry point and the integration tests so both run the same graph.
 */
export function composeHelpdesk({
  store,
  whatsapp,
  sender = webhookSender,
  hasher = passwordHasher,
  now = () => Math.floor(Date.now() / 1000),
  webDir,
}) {
  const bus = eventBus(),
    users = usersStore(store.db),
    repository = helpdeskStore(store.db);
  const helpdesk = helpdeskService({ helpdesk: repository, users, whatsapp, mirror: store, bus, now });
  const deps = { helpdesk: repository, users, bus, now };
  const notifications = notificationService(deps);
  const webhooks = webhookService({ ...deps, sender });
  const automations = automationService({ ...deps, conversations: helpdesk });
  const reports = reportService(deps);
  const autoReplies = autoReplyService({ ...deps, conversations: helpdesk });
  for (const service of [notifications, webhooks, automations, reports, autoReplies]) service.listen();
  return {
    bus,
    users,
    repository,
    helpdesk,
    support: {
      accounts: accountService({ users, helpdesk: repository, hasher, bus }),
      helpdesk,
      catalog: catalogService({ helpdesk: repository, bus }),
      notifications,
      realtime: realtimeService({ bus, users }),
      webhooks,
      automations,
      reports,
      webDir,
    },
    /** Periodic jobs: snooze wake-ups and webhook deliveries. Returns a stop function. */
    startJobs() {
      const timers = [
        setInterval(() => helpdesk.wakeSnoozed(), 60000),
        setInterval(() => void webhooks.deliverDue(), 10000),
      ];
      return () => timers.forEach(clearInterval);
    },
  };
}
