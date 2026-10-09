import { Fragment } from 'react';
import { splitMentions } from './mentions';
import { formatWhatsApp } from './whatsappFormat';

/** Message body: WhatsApp markup as text nodes and mentions as "@Nome" chips (never raw links). */
export function MessageBody({ content }: { content: string }) {
  return (
    <p className="break-words whitespace-pre-wrap">
      {splitMentions(content).map((segment, i) =>
        'mention' in segment ? (
          <span
            key={i}
            data-mention={segment.id}
            className="rounded bg-n-blue-3 px-1 font-medium text-n-blue-11"
          >
            @{segment.mention}
          </span>
        ) : (
          <Fragment key={i}>{formatWhatsApp(segment.text, `s${i}`)}</Fragment>
        ),
      )}
    </p>
  );
}
