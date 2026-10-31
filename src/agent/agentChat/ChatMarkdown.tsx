import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** How each Markdown element looks inside a chat bubble (raw HTML in the text is never rendered). */
const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="break-words whitespace-pre-wrap [&:not(:first-child)]:mt-2">{children}</p>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-n-blue-11 underline break-all">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 border-n-slate-7 pl-3 text-n-slate-11">{children}</blockquote>
  ),
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-n-alpha-2 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-n-alpha-2 p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-n-weak bg-n-alpha-1 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-n-weak px-2 py-1 align-top">{children}</td>,
  hr: () => <hr className="my-3 border-n-weak" />,
};

/** A chat message written in Markdown (what the agents write): lists, tables, code, links. */
export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
}
