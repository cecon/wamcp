import type { ReactNode } from 'react';

// material-ui
import MuiButton, { type ButtonProps as MuiButtonProps } from '@mui/material/Button';

import type { LucideIcon } from 'lucide-react';

type Color = 'blue' | 'slate' | 'ruby' | 'amber' | 'teal';
type Variant = 'solid' | 'faded' | 'ghost' | 'link';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const COLOR: Record<Color, MuiButtonProps['color']> = {
  blue: 'primary',
  slate: 'inherit',
  ruby: 'error',
  amber: 'warning',
  teal: 'success',
};
const VARIANT: Record<Variant, MuiButtonProps['variant']> = {
  solid: 'contained',
  faded: 'outlined',
  ghost: 'text',
  link: 'text',
};
const SIZE: Record<Size, MuiButtonProps['size']> = { xs: 'small', sm: 'small', md: 'medium', lg: 'large' };
const ICON: Record<Size, number> = { xs: 14, sm: 16, md: 16, lg: 18 };

interface Props extends Omit<MuiButtonProps, 'color' | 'variant' | 'size' | 'startIcon' | 'endIcon'> {
  color?: Color;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  label?: ReactNode;
}

/** Botão do app sobre o `Button` do MUI (mesma API: cor/variante/tamanho/ícones/`label`). */
export function Button({
  color = 'blue',
  variant = 'solid',
  size = 'sm',
  icon: Icon,
  trailingIcon: Trailing,
  label,
  children,
  sx,
  ...rest
}: Props) {
  const content = label ?? children;
  return (
    <MuiButton
      {...rest}
      color={COLOR[color]}
      variant={VARIANT[variant]}
      size={SIZE[size]}
      startIcon={Icon ? <Icon size={ICON[size]} /> : undefined}
      endIcon={Trailing ? <Trailing size={ICON[size]} /> : undefined}
      sx={{
        minWidth: 0,
        whiteSpace: 'nowrap',
        textTransform: 'none',
        ...(variant === 'link' ? { px: 0, minHeight: 0, verticalAlign: 'baseline' } : {}),
        ...sx,
      }}
    >
      {content}
    </MuiButton>
  );
}
