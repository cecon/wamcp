import type { Inbox } from '../types';

/** What the inbox list and header say about the channel. */
export const channelLine = (i: Inbox) =>
  i.channel_type === 'github'
    ? `GitHub · ${i.github_repo}`
    : `WhatsApp · ${i.phone ? `+${i.phone}` : 'sem número'} · ${i.session_status === 'connected' ? 'conectado' : i.session_status}`;
