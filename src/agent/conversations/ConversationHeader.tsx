import { AlarmClockMinus, ArrowLeft, ChevronDown, CircleDotDashed, PanelRight } from 'lucide-react';
import type { Conversation, ConversationStatus } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dropdown, MenuItem } from '../ui/Overlay';

const SNOOZE: { label: string; hours: number }[] = [
  { label: 'Por 1 hora', hours: 1 },
  { label: 'Até amanhã', hours: 24 },
  { label: 'Por uma semana', hours: 24 * 7 },
];

interface Props {
  conversation: Conversation;
  panelOpen: boolean;
  onBack: () => void;
  onTogglePanel: () => void;
  onStatus: (status: ConversationStatus, snoozedUntil?: number) => void;
}

/** Chatwoot ConversationHeader + ResolveAction split button (snooze / pending menu). */
export function ConversationHeader({ conversation: c, panelOpen, onBack, onTogglePanel, onStatus }: Props) {
  const name = c.contact_name || c.contact_phone || 'Contato';
  const main =
    c.status === 'open'
      ? { label: 'Resolver', status: 'resolved' as const }
      : c.status === 'pending'
        ? { label: 'Abrir', status: 'open' as const }
        : { label: 'Reabrir', status: 'open' as const };
  const snoozedUntil =
    c.status === 'snoozed' && c.snoozed_until
      ? new Date(c.snoozed_until * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : null;
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-n-weak px-3 pt-3 pb-2">
      <div className="flex min-w-0 items-center">
        <Button
          color="slate"
          variant="ghost"
          icon={ArrowLeft}
          aria-label="Voltar"
          onClick={onBack}
          className="mr-1 md:hidden"
        />
        <Avatar name={name} size={32} />
        <div className="ms-2 min-w-0">
          <p className="truncate text-sm leading-tight font-medium text-n-slate-12">{name}</p>
          <p className="truncate text-xs text-n-slate-11">
            #{c.display_id} • {c.inbox_name}
            {c.status === 'pending' && <span className="text-n-iris-9"> • com a IA</span>}
            {snoozedUntil && <span className="text-n-amber-11"> • adiada até {snoozedUntil}</span>}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex rounded-lg shadow-sm">
          <Button
            color="slate"
            label={main.label}
            className="rounded-r-none"
            onClick={() => onStatus(main.status)}
          />
          <Dropdown
            trigger={({ toggle }) => (
              <Button
                color="slate"
                icon={ChevronDown}
                aria-label="Mais ações de status"
                className="rounded-l-none border-l border-n-weak"
                onClick={toggle}
              />
            )}
          >
            {(close) => (
              <>
                {c.status !== 'snoozed' &&
                  SNOOZE.map((s) => (
                    <MenuItem
                      key={s.hours}
                      icon={AlarmClockMinus}
                      label={`Adiar ${s.label.toLowerCase()}`}
                      onClick={() => {
                        onStatus('snoozed', Math.floor(Date.now() / 1000) + s.hours * 3600);
                        close();
                      }}
                    />
                  ))}
                {c.status !== 'pending' && (
                  <MenuItem
                    icon={CircleDotDashed}
                    label="Marcar como pendente"
                    onClick={() => {
                      onStatus('pending');
                      close();
                    }}
                  />
                )}
              </>
            )}
          </Dropdown>
        </div>
        <Button
          color="slate"
          variant="ghost"
          icon={PanelRight}
          aria-label={panelOpen ? 'Ocultar painel do contato' : 'Mostrar painel do contato'}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        />
      </div>
    </header>
  );
}
