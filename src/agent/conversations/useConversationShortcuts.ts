import type { Conversation, ConversationStatus } from '../types';
import { triggerElement, useHotkeys } from '../shortcuts/hotkeys';

interface Options {
  conversation: Conversation | null;
  onStatus: (status: ConversationStatus) => void;
  onAssignToMe: () => void;
  /** Opens the contact panel so the labels picker exists. */
  onShowPanel: () => void;
}

/** Chatwoot conversation shortcuts: Alt+E resolve, Alt+O reopen, Alt+A assign to me, Alt+L labels, / composer. */
export function useConversationShortcuts({ conversation, onStatus, onAssignToMe, onShowPanel }: Options) {
  useHotkeys([
    {
      keys: 'alt+e',
      run: () => conversation && conversation.status !== 'resolved' && onStatus('resolved'),
    },
    {
      keys: 'alt+o',
      run: () => conversation && conversation.status !== 'open' && onStatus('open'),
    },
    { keys: 'alt+a', run: () => conversation && onAssignToMe() },
    {
      keys: 'alt+l',
      run: () => {
        if (triggerElement('labels', 'click')) return;
        onShowPanel();
        setTimeout(() => triggerElement('labels', 'click'), 0);
      },
    },
    { keys: '/', run: () => triggerElement('composer', 'focus') },
  ]);
}
