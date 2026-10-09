import type { ReactNode } from 'react';
import { SettingsPage } from '../ui/Settings';
import { cn } from '../ui/cn';

/** Chatwoot report card: rounded solid surface with an optional title and LIVE chip. */
export function ReportCard({
  title,
  live,
  className,
  children,
}: {
  title?: string;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-4 rounded-xl bg-n-solid-2 px-6 py-5 shadow outline outline-1 -outline-offset-1 outline-n-container',
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium text-n-slate-12">{title}</h2>
          {live && (
            <span className="flex items-center gap-1 rounded bg-n-teal-3 px-2 py-0.5 text-xs text-n-teal-11">
              <span className="size-1 rounded-full bg-n-teal-9" /> AO VIVO
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Chatwoot ReportMetricCard: small label above a large value, with an optional hint below. */
export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) => (
  <div>
    <p className="text-sm font-medium text-n-slate-11">{label}</p>
    <p className="mt-1 text-2xl text-n-slate-12">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-n-slate-11">{hint}</p>}
  </div>
);

/** Report page frame: title with the filters on the right, then an error line and the content. */
export function ReportLayout({
  title,
  filters,
  error,
  children,
}: {
  title: string;
  filters?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <SettingsPage>
      <header className="flex flex-wrap items-center justify-between gap-3 pt-2 pb-1">
        <h1 className="text-heading-1 text-n-slate-12">{title}</h1>
        {filters}
      </header>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      {children}
    </SettingsPage>
  );
}
