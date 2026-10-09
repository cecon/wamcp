import type { ReactNode } from 'react';

/*
 * WhatsApp markup: ```monospace```, *bold*, _italic_ and ~strike~. Markers only count at word
 * boundaries (so snake_case_names stay intact) and the text is always rendered as React text nodes.
 */
const EDGE = '(?<![\\p{L}\\p{N}_*~])';
const END = '(?![\\p{L}\\p{N}])';
const inline = (raw: string) => {
  const mark = raw === '*' ? '\\*' : raw;
  return `${EDGE}${mark}([^\\s${mark}](?:[^${mark}\\n]*[^\\s${mark}])?)${mark}${END}`;
};
const PATTERN = new RegExp(`\`\`\`([\\s\\S]+?)\`\`\`|${inline('*')}|${inline('_')}|${inline('~')}`, 'gu');

export function formatWhatsApp(text: string, prefix = 'f'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    const key = `${prefix}-${index}`;
    const [, code, bold, italic, strike] = match;
    if (code !== undefined)
      nodes.push(
        <code key={key} className="rounded bg-n-alpha-black1 px-1 font-mono text-[0.8125rem]">
          {code}
        </code>,
      );
    else if (bold !== undefined) nodes.push(<strong key={key}>{formatWhatsApp(bold, key)}</strong>);
    else if (italic !== undefined) nodes.push(<em key={key}>{formatWhatsApp(italic, key)}</em>);
    else nodes.push(<s key={key}>{formatWhatsApp(strike, key)}</s>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
