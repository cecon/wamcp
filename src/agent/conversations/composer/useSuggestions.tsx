import { useState, type KeyboardEvent } from 'react';
import type { Canned, Conversation, User } from '../../types';
import { mentionCandidates, mentionQuery, withMentionMarkup } from '../mentions';
import { CannedList, MentionList } from './ComposerPickers';
import { fillVariables, useCanned } from './composerState';

interface Args {
  text: string;
  caret: number;
  note: boolean;
  agents: User[];
  conversation?: Conversation;
  user?: User;
  /** Replaces the composer text and moves the caret. */
  onText: (text: string, caret: number) => void;
}

/**
 * Composer pop-ups: "/shortcut" canned responses and, in private notes, "@agent" mentions
 * (Chatwoot TagAgents). Picked agents show as "@Nome" and become mention markdown on send.
 */
export function useSuggestions({ text, caret, note, agents, conversation, user, onText }: Args) {
  const shortcut = /^\/(\S*)$/.exec(text)?.[1];
  const canned = useCanned(shortcut);
  const mention = note ? mentionQuery(text, caret) : undefined;
  const people = mention ? mentionCandidates(agents, mention.query, conversation?.inbox_id) : [];
  const [mentionIndex, setMentionIndex] = useState(0),
    [picked, setPicked] = useState<User[]>([]);

  const pickCanned = (c: Canned) => {
    const filled = fillVariables(c.content, conversation, user);
    onText(filled, filled.length);
  };
  const pickMention = (agent: User) => {
    if (!mention) return;
    const before = `${text.slice(0, mention.start)}@${agent.name} `;
    onText(before + text.slice(caret), before.length);
    setPicked((list) => [...list.filter((a) => a.id !== agent.id), agent]);
    setMentionIndex(0);
  };

  const highlight = Math.min(mentionIndex, Math.max(people.length - 1, 0));
  const list = people.length
    ? {
        size: people.length,
        index: highlight,
        move: setMentionIndex,
        pick: () => pickMention(people[highlight]),
      }
    : canned.options.length
      ? {
          size: canned.options.length,
          index: canned.highlight,
          move: canned.setHighlight,
          pick: () => pickCanned(canned.options[canned.highlight]),
        }
      : null;

  /** Arrow keys move the highlight, Enter/Tab pick it; returns whether the key was handled. */
  function onKeyDown(e: KeyboardEvent) {
    if (!list) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list.move((list.index + (e.key === 'ArrowDown' ? 1 : list.size - 1)) % list.size);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      list.pick();
      return true;
    }
    return false;
  }

  const popup = people.length ? (
    <MentionList
      query={mention?.query || ''}
      options={people}
      highlight={highlight}
      onHighlight={setMentionIndex}
      onPick={pickMention}
    />
  ) : canned.options.length ? (
    <CannedList
      shortcut={shortcut || ''}
      options={canned.options}
      highlight={canned.highlight}
      onHighlight={canned.setHighlight}
      onPick={pickCanned}
    />
  ) : null;

  return {
    popup,
    onKeyDown,
    /** The content to send, with picked mentions as markdown. */
    content: (raw: string) => (note ? withMentionMarkup(raw, picked) : raw),
    reset: () => setPicked([]),
  };
}
