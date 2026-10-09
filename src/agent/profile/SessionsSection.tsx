import { useCallback, useEffect, useState } from 'react';
import { LogOut, Monitor } from 'lucide-react';
import { http } from '../api';
import type { SessionInfo } from '../accountTypes';
import { useAction } from '../settings/useAction';
import { Button } from '../ui/Button';
import { describeUserAgent, formatDateTime } from './browser';

/** Active browser sessions (GET /profile/sessions): revoke one or every other session. */
export function SessionsSection() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<SessionInfo[]>('/profile/sessions').then(setSessions), []);
  useEffect(() => {
    void load().catch(() => setSessions([]));
  }, [load]);
  const others = (sessions || []).filter((s) => !s.current);
  const revoke = (path: string) =>
    void run(async () => {
      await http(path, 'DELETE');
      await load();
    });

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <ul aria-label="Sessões ativas" className="divide-y divide-n-weak rounded-xl border border-n-weak">
        {(sessions || []).map((s) => {
          const name = describeUserAgent(s.user_agent);
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Monitor size={18} className="shrink-0 text-n-slate-10" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-n-slate-12">
                  {name}
                  {s.current && (
                    <span className="rounded-md bg-n-teal-3 px-1.5 text-xs text-n-teal-11">Esta sessão</span>
                  )}
                </p>
                <p className="text-xs text-n-slate-11">
                  Entrou em {formatDateTime(s.created)} · Último acesso{' '}
                  {formatDateTime(s.last_seen || s.created)}
                </p>
              </div>
              {!s.current && (
                <Button
                  color="ruby"
                  variant="faded"
                  size="xs"
                  label="Encerrar"
                  aria-label={`Encerrar sessão ${name}`}
                  disabled={busy}
                  onClick={() => revoke(`/profile/sessions/${s.id}`)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {sessions && others.length > 0 && (
        <Button
          color="ruby"
          variant="faded"
          icon={LogOut}
          className="self-start"
          label="Encerrar outras sessões"
          disabled={busy}
          onClick={() => revoke('/profile/sessions')}
        />
      )}
    </div>
  );
}
