import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeIncoming,
  routeOwnMessage,
  nextAssignee,
  isSupportJid,
  phoneFromJid,
  canAccessInbox,
  validateStatusChange,
  requireAdmin,
} from '../server/domain/helpdesk.mjs';

test('incoming messages reuse open conversations and wake snoozed ones', () => {
  assert.deepEqual(routeIncoming(null, {}), { action: 'create' });
  assert.deepEqual(routeIncoming({ status: 'open' }, {}), { action: 'reuse', reopen: false });
  assert.deepEqual(routeIncoming({ status: 'pending' }, {}), { action: 'reuse', reopen: false });
  assert.deepEqual(routeIncoming({ status: 'snoozed' }, {}), { action: 'reuse', reopen: true });
});

test('resolved conversations reopen only when the inbox locks contacts to one conversation', () => {
  const resolved = { status: 'resolved' };
  assert.deepEqual(routeIncoming(resolved, { lock_to_single_conversation: 1 }), {
    action: 'reuse',
    reopen: true,
  });
  assert.deepEqual(routeIncoming(resolved, { lock_to_single_conversation: 0 }), { action: 'create' });
});

test('messages typed on the phone never open new conversations', () => {
  assert.equal(routeOwnMessage(null).action, 'ignore');
  assert.equal(routeOwnMessage({ status: 'resolved' }).action, 'ignore');
  assert.equal(routeOwnMessage({ status: 'open' }).action, 'reuse');
});

test('round robin continues after the last assignee and wraps around', () => {
  assert.equal(nextAssignee([], 3), null);
  assert.equal(nextAssignee([5, 2, 9], null), 2);
  assert.equal(nextAssignee([5, 2, 9], 2), 5);
  assert.equal(nextAssignee([5, 2, 9], 9), 2);
  assert.equal(nextAssignee([5, 2, 9], 4), 5);
});

test('groups, broadcasts and channels are not support conversations', () => {
  assert.equal(isSupportJid('5511999999999@s.whatsapp.net'), true);
  assert.equal(isSupportJid('123456@lid'), true);
  assert.equal(isSupportJid('120363@g.us'), false);
  assert.equal(isSupportJid('120363@g.us', { ignoreGroups: false }), true);
  assert.equal(isSupportJid('status@broadcast', { ignoreGroups: false }), false);
  assert.equal(isSupportJid('1203@newsletter'), false);
});

test('phone numbers are derived only from phone-number JIDs', () => {
  assert.equal(phoneFromJid('5511999999999@s.whatsapp.net'), '+5511999999999');
  assert.equal(phoneFromJid('5511999999999:12@s.whatsapp.net'), '+5511999999999');
  assert.equal(phoneFromJid('123456@lid'), null);
  assert.equal(phoneFromJid(null), null);
});

test('agents only reach their inboxes; administrators reach all', () => {
  assert.equal(canAccessInbox({ role: 'administrator' }, [], 7), true);
  assert.equal(canAccessInbox({ role: 'agent' }, [1, 2], 2), true);
  assert.equal(canAccessInbox({ role: 'agent' }, [1, 2], 7), false);
  assert.throws(() => requireAdmin({ role: 'agent' }), { status: 403 });
});

test('status changes are validated', () => {
  assert.throws(() => validateStatusChange('closed', null, 100));
  assert.throws(() => validateStatusChange('snoozed', 50, 100));
  assert.doesNotThrow(() => validateStatusChange('snoozed', 150, 100));
  assert.doesNotThrow(() => validateStatusChange('resolved', null, 100));
});
