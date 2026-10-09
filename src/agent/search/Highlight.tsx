const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marks every case-insensitive occurrence of `term` in `text` (Chatwoot search highlight). */
export function Highlight({ text, term }: { text: string | null | undefined; term: string }) {
  if (!text) return null;
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escape(term)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-n-amber-3 px-0.5 text-n-slate-12">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
