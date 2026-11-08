import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';

/** Unread/count pill (Chatwoot SidebarUnreadBadge: 99+). */
export function CountPill({ value }: { value: number }) {
  if (!value) return null;
  return (
    <Box
      component="span"
      sx={{
        ml: 'auto',
        display: 'flex',
        height: 20,
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 99,
        bgcolor: 'var(--color-n-slate-4)',
        px: 0.5,
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--color-n-slate-12)',
      }}
    >
      {value > 99 ? '99+' : value}
    </Box>
  );
}

const itemSx = {
  display: 'flex',
  height: 32,
  width: '100%',
  alignItems: 'center',
  gap: 1,
  borderRadius: 1,
  textAlign: 'left',
  justifyContent: 'flex-start',
  '&:hover': { bgcolor: 'var(--color-n-alpha-2)' },
} as const;

interface GroupProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  parentOfActive: boolean;
  expanded?: boolean;
  count?: number;
  onClick: () => void;
  children?: ReactNode;
}

/** Top-level item (Chatwoot SidebarGroupHeader) with an optional expandable tree. */
export function SidebarGroup({
  icon: Icon,
  label,
  active,
  parentOfActive,
  expanded,
  count,
  onClick,
  children,
}: GroupProps) {
  const expandable = children !== undefined;
  return (
    <Box component="li">
      <ButtonBase
        onClick={onClick}
        aria-expanded={expandable ? expanded : undefined}
        aria-current={active ? 'page' : undefined}
        sx={{
          ...itemSx,
          px: 0.75,
          bgcolor: active ? 'var(--color-n-alpha-2)' : 'transparent',
          color: active || parentOfActive ? 'var(--color-n-slate-12)' : 'var(--color-n-slate-11)',
          fontWeight: active || parentOfActive ? 500 : 400,
        }}
      >
        <Box component="span" sx={{ flexShrink: 0, display: 'flex' }}>
          <Icon size={16} />
        </Box>
        <Typography component="span" noWrap sx={{ minWidth: 0, flex: 1, fontSize: 14 }}>
          {label}
        </Typography>
        {count ? <CountPill value={count} /> : null}
        {expandable && (expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </ButtonBase>
      {expandable && expanded && (
        <Box
          component="ul"
          sx={{ mt: 1, display: 'flex', flexDirection: 'column', listStyle: 'none', m: 0, p: 0 }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

interface LeafProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number;
  /** Listed under a sub-group heading (Times, Canais, Etiquetas): indented one more level. */
  nested?: boolean;
}

const connector = {
  position: 'relative',
  ms: 1.5,
  ps: 1,
  minWidth: 0,
  py: 0.25,
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    bottom: 0,
    insetInlineStart: 0,
    width: 2,
    bgcolor: 'var(--color-n-slate-4)',
  },
  '&:last-of-type::before': { bottom: '50%' },
} as const;

/** Child item with the tree connector line (Chatwoot SidebarGroupLeaf). */
export function SidebarLeaf({ label, active, onClick, icon, count, nested }: LeafProps) {
  return (
    <Box component="li" sx={connector}>
      <ButtonBase
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        sx={{
          ...itemSx,
          px: 1,
          ps: nested ? 4 : 1,
          bgcolor: active ? 'var(--color-n-alpha-2)' : 'transparent',
          color: active ? 'var(--color-n-slate-12)' : 'var(--color-n-slate-11)',
        }}
      >
        {icon}
        <Typography component="span" noWrap sx={{ minWidth: 0, flex: 1, fontSize: 14 }}>
          {label}
        </Typography>
        {count ? <CountPill value={count} /> : null}
      </ButtonBase>
    </Box>
  );
}

/** Sub-group heading inside a group (Chatwoot SidebarGroupSeparator: Teams, Channels, Labels). */
export function SidebarSeparator({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Box component="li" sx={connector}>
      <Stack direction="row" spacing={1} sx={{ height: 32, alignItems: 'center', px: 1, py: 0.75 }}>
        <Icon size={16} />
        <Typography component="span" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--color-n-slate-10)' }}>
          {label}
        </Typography>
      </Stack>
    </Box>
  );
}
