import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Chatwoot components/Modal.vue: blurred backdrop, 600px panel, header px-8 pt-8. */
export function Modal({ title, description, onClose, children }: ModalProps) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-n-alpha-black2 p-4 backdrop-blur-[4px]">
      <div
        role="dialog"
        aria-label={title}
        className="relative max-h-full w-[37.5rem] max-w-full overflow-y-auto rounded-xl bg-n-alpha-3 shadow-md backdrop-blur-[100px] outline outline-1 outline-n-container"
      >
        <Button
          variant="ghost"
          color="slate"
          icon={X}
          aria-label="Fechar"
          onClick={onClose}
          className="absolute top-3 right-3"
        />
        <div className="px-8 pt-8">
          <h2 className="text-base font-semibold text-n-slate-12">{title}</h2>
          {description && <p className="mt-2 text-sm text-n-slate-11">{description}</p>}
        </div>
        <div className="px-8 pt-4 pb-8">{children}</div>
      </div>
    </div>
  );
}

/** Right side panel used by Chatwoot for automation rules. */
export function SidePanel({ title, onClose, children }: ModalProps) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 bg-n-alpha-black1">
      <div
        role="dialog"
        aria-label={title}
        className="fixed inset-y-3 end-3 flex w-[40rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-xl bg-n-solid-1 shadow-lg outline outline-1 outline-n-container"
      >
        <div className="flex items-center justify-between border-b border-n-weak px-6 py-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" color="slate" icon={X} aria-label="Fechar" onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  placement?: 'bottom' | 'top';
  className?: string;
}

/** Chatwoot dropdown-menu: translucent blurred body, rounded-xl, p-2. */
export function Dropdown({
  trigger,
  children,
  align = 'end',
  placement = 'bottom',
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 grid min-w-[9.75rem] gap-1 rounded-xl border border-n-weak bg-n-alpha-3 p-2 text-sm shadow-sm backdrop-blur-[100px]',
            align === 'end' ? 'right-0' : 'left-0',
            placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
            className,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon?: (props: { size?: number; className?: string }) => ReactNode;
  label: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-n-alpha-2',
        danger ? 'text-n-ruby-11' : 'text-n-slate-12',
        active && 'bg-n-alpha-2',
      )}
    >
      {Icon && <Icon size={16} className={danger ? 'text-n-ruby-11' : 'text-n-slate-11'} />}
      {label}
    </button>
  );
}
