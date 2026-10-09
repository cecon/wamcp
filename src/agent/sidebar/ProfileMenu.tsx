import { Power } from 'lucide-react';
import type { Availability, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { Dropdown, MenuItem } from '../ui/Overlay';
import { cn } from '../ui/cn';

const AVAILABILITY: { value: Availability; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: 'bg-n-teal-9' },
  { value: 'busy', label: 'Ocupado', color: 'bg-n-amber-9' },
  { value: 'offline', label: 'Offline', color: 'bg-n-slate-9' },
];

interface Props {
  user: User;
  online: boolean;
  onAvailability: (value: Availability) => void;
  onLogout: () => void;
}

/** Chatwoot SidebarProfileMenu: avatar + name/email, opening availability and logout. */
export function ProfileMenu({ user, online, onAvailability, onLogout }: Props) {
  return (
    <div className="border-t border-n-weak px-1 py-1.5 shadow-[0_-2px_4px_rgba(27,28,29,0.02)]">
      <Dropdown
        align="start"
        placement="top"
        className="w-64"
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label="Perfil"
            className="flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-n-alpha-1"
          >
            <Avatar name={user.name} size={32} status={user.availability} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-4 font-medium text-n-slate-12">
                {user.name}
              </span>
              <span className="block truncate text-xs text-n-slate-11">{user.email}</span>
            </span>
            <span
              className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-n-teal-9' : 'bg-n-ruby-9')}
              title={online ? 'Tempo real conectado' : 'Reconectando…'}
            />
          </button>
        )}
      >
        {(close) => (
          <>
            <p className="px-2 pt-1 text-xs font-medium text-n-slate-10">Disponibilidade</p>
            {AVAILABILITY.map((a) => (
              <MenuItem
                key={a.value}
                active={user.availability === a.value}
                label={
                  <span className="flex items-center gap-3">
                    <span className={cn('size-2 rounded-sm', a.color)} />
                    {a.label}
                  </span>
                }
                onClick={() => {
                  onAvailability(a.value);
                  close();
                }}
              />
            ))}
            <div className="my-1 h-px bg-n-weak" />
            <MenuItem icon={Power} label="Sair" onClick={onLogout} />
          </>
        )}
      </Dropdown>
    </div>
  );
}
