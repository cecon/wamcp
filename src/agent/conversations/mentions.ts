import type { User } from '../types';

/** Chatwoot mention markdown: `[@Nome](mention://user/<id>/Nome)` (teams use `mention://team/`). */
const MENTION = /\[@([^\]\n]+)\]\(mention:\/\/(?:user|team)\/(\d+)\/[^)\s]*\)/g;

export type Segment = { text: string } | { mention: string; id: number };
type Mentionable = Pick<User, 'id' | 'name'>;

/** Splits a note into plain text and mentions, so mentions render as chips (never as raw links). */
export function splitMentions(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ mention: match[1], id: Number(match[2]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** One-line previews show mentions as "@Nome". */
export const plainMentions = (text: string) => text.replace(MENTION, '@$1');

export const mentionMarkup = (agent: Mentionable) =>
  `[@${agent.name}](mention://user/${agent.id}/${encodeURIComponent(agent.name)})`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turns the "@Nome" picked in the composer into mention markdown (one pass, longest names first). */
export function withMentionMarkup(text: string, picked: Mentionable[]) {
  if (!picked.length) return text;
  const byName = new Map(picked.map((a) => [a.name, a]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`@(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(pattern, (whole, name: string) => {
    const agent = byName.get(name);
    return agent ? mentionMarkup(agent) : whole;
  });
}

/** The "@query" typed right before the caret (at the start or after a space). */
export function mentionQuery(text: string, caret: number) {
  const match = /(^|\s)@([^\s@]{0,30})$/u.exec(text.slice(0, caret));
  if (!match) return undefined;
  return { start: match.index + match[1].length, query: match[2] };
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Active agents who can see the inbox (administrators see every inbox), matching the query. */
export function mentionCandidates(agents: User[], query: string, inboxId?: number) {
  const wanted = fold(query);
  return agents
    .filter(
      (a) =>
        a.active &&
        (a.role === 'administrator' || !a.inbox_ids || !inboxId || a.inbox_ids.includes(inboxId)) &&
        fold(`${a.name} ${a.display_name || ''}`).includes(wanted),
    )
    .slice(0, 8);
}
