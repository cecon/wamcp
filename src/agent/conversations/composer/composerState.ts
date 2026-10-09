import { useCallback, useEffect, useRef, useState } from 'react';
import { http, query } from '../../api';
import type { Canned, Conversation, User } from '../../types';

/* Per-conversation drafts, like Chatwoot's draftMessages store (kept in localStorage). */
const draftKey = (path: string) => `wamcp.agent.draft:${path}`;
export function loadDraft(path: string) {
  try {
    return localStorage.getItem(draftKey(path)) || '';
  } catch {
    return '';
  }
}
export function saveDraft(path: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(path), text);
    else localStorage.removeItem(draftKey(path));
  } catch {
    // Storage blocked (private mode, quota): drafts are a convenience only.
  }
}

/** Chatwoot canned-response variables: {{contact.name}}, {{agent.name}}, ... Unknown values become ''. */
export function fillVariables(content: string, conversation?: Conversation, user?: User) {
  const values: Record<string, string | number | null | undefined> = {
    'contact.name': conversation?.contact_name,
    'contact.phone': conversation?.contact_phone,
    'agent.name': user ? user.display_name || user.name : undefined,
    'conversation.id': conversation?.display_id,
    'inbox.name': conversation?.inbox_name,
  };
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    key in values ? String(values[key] ?? '') : whole,
  );
}

/** "/shortcut" lookup with a short debounce, like CannedResponse.vue. */
export function useCanned(shortcut: string | undefined) {
  const [canned, setCanned] = useState<Canned[]>([]),
    [highlight, setHighlight] = useState(0);
  useEffect(() => {
    if (shortcut === undefined) return;
    const handle = setTimeout(
      () =>
        void http<Canned[]>(`/canned_responses${query({ q: shortcut })}`)
          .then((list) => {
            setCanned(list.slice(0, 8));
            setHighlight(0);
          })
          .catch(() => setCanned([])),
      150,
    );
    return () => clearTimeout(handle);
  }, [shortcut]);
  return { options: shortcut !== undefined ? canned : [], highlight, setHighlight };
}

const IDLE = 3000;

/**
 * Chatwoot typing status: "on" at most once every 3 s while typing, "off" after 3 s idle,
 * on send and on unmount; "recording" while a voice note is being recorded.
 */
export function useTypingStatus(path: string, isPrivate: boolean) {
  const ref = useRef({
    lastOn: 0,
    active: false,
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const privateNote = useRef(isPrivate);
  useEffect(() => {
    privateNote.current = isPrivate;
  }, [isPrivate]);
  const post = useCallback(
    (typing_status: 'on' | 'off' | 'recording') =>
      void http(`${path}/toggle_typing_status`, 'POST', {
        typing_status,
        is_private: privateNote.current,
      }).catch(() => {}),
    [path],
  );
  const stop = useCallback(() => {
    clearTimeout(ref.current.idle);
    if (!ref.current.active) return;
    ref.current.active = false;
    ref.current.lastOn = 0;
    post('off');
  }, [post]);
  const typing = useCallback(() => {
    const now = Date.now();
    if (now - ref.current.lastOn >= IDLE) {
      ref.current.lastOn = now;
      ref.current.active = true;
      post('on');
    }
    clearTimeout(ref.current.idle);
    ref.current.idle = setTimeout(stop, IDLE);
  }, [post, stop]);
  const recording = useCallback(() => {
    clearTimeout(ref.current.idle);
    ref.current.active = true;
    post('recording');
  }, [post]);
  useEffect(() => stop, [stop]);
  return { typing, stop, recording };
}
