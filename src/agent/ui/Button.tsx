import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from './cn';

type Color = 'blue' | 'slate' | 'ruby' | 'amber' | 'teal';
type Variant = 'solid' | 'faded' | 'ghost' | 'link';
type Size = 'xs' | 'sm' | 'md' | 'lg';

/** Chatwoot components-next/button/Button.vue variants. */
const COLORS: Record<Color, Record<Variant, string>> = {
  blue: {
    solid: 'bg-n-brand text-white outline-transparent hover:brightness-110',
    faded: 'bg-n-brand/10 text-n-blue-11 outline-transparent hover:bg-n-brand/20',
    ghost: 'text-n-blue-11 outline-transparent hover:bg-n-alpha-2',
    link: 'text-n-blue-11 outline-transparent hover:underline',
  },
  slate: {
    solid: 'bg-n-button-color text-n-slate-12 outline-n-container hover:bg-n-alpha-2',
    faded: 'bg-n-slate-9/10 text-n-slate-12 outline-transparent hover:bg-n-slate-9/20',
    ghost: 'text-n-slate-12 outline-transparent hover:bg-n-alpha-2',
    link: 'text-n-slate-11 outline-transparent hover:underline',
  },
  ruby: {
    solid: 'bg-n-ruby-9 text-white outline-transparent hover:brightness-110',
    faded: 'bg-n-ruby-9/10 text-n-ruby-11 outline-transparent hover:bg-n-ruby-9/20',
    ghost: 'text-n-ruby-11 outline-transparent hover:bg-n-ruby-2',
    link: 'text-n-ruby-11 outline-transparent hover:underline',
  },
  amber: {
    solid: 'bg-n-amber-9 text-n-amber-12 outline-transparent hover:brightness-105',
    faded: 'bg-n-amber-9/10 text-n-amber-11 outline-transparent',
    ghost: 'text-n-amber-11 outline-transparent hover:bg-n-alpha-2',
    link: 'text-n-amber-11 outline-transparent hover:underline',
  },
  teal: {
    solid: 'bg-n-teal-9 text-white outline-transparent hover:brightness-110',
    faded: 'bg-n-teal-9/10 text-n-teal-11 outline-transparent',
    ghost: 'text-n-teal-11 outline-transparent hover:bg-n-alpha-2',
    link: 'text-n-teal-11 outline-transparent hover:underline',
  },
};
const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1',
  sm: 'h-8 px-3 text-sm gap-2',
  md: 'h-10 px-4 text-sm font-medium gap-2',
  lg: 'h-12 px-5 text-base font-medium gap-2',
};
const SQUARE: Record<Size, string> = { xs: 'size-6', sm: 'size-8', md: 'size-10', lg: 'size-12' };
const ICON: Record<Size, number> = { xs: 14, sm: 16, md: 16, lg: 18 };

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: Color;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  label?: ReactNode;
}

export function Button({
  color = 'blue',
  variant = 'solid',
  size = 'sm',
  icon: Icon,
  trailingIcon: Trailing,
  label,
  children,
  className,
  type = 'button',
  ...rest
}: Props) {
  const content = label ?? children;
  const iconOnly = Boolean(Icon) && (content === undefined || content === null || content === '');
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg outline outline-1 -outline-offset-1 whitespace-nowrap transition-all duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        COLORS[color][variant],
        iconOnly ? cn(SQUARE[size], 'p-0') : SIZES[size],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={ICON[size]} className="shrink-0" />}
      {!iconOnly && content}
      {Trailing && <Trailing size={ICON[size]} className="shrink-0" />}
    </button>
  );
}
