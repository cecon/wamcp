import { useState, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';

/** Chatwoot ContactPanel accordion section (title bar with +/− and a padded body). */
export function Accordion({
  title,
  open: initial = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg bg-n-slate-2 px-4 py-2 text-sm text-n-slate-12 outline outline-1 -outline-offset-1 outline-n-weak"
      >
        {title}
        {open ? (
          <Minus size={16} className="text-n-blue-11" />
        ) : (
          <Plus size={16} className="text-n-blue-11" />
        )}
      </button>
      {open && <div className="rounded-b-lg px-2 py-4">{children}</div>}
    </section>
  );
}
