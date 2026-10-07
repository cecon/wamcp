import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Conversation, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dropdown, MenuItem } from '../ui/Overlay';

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onError: (message: string) => void;
}

/** Chatwoot "Participantes da conversa": agents who follow the conversation, with join/leave. */
export function ParticipantsSection({ conversation: c, user, catalog, onError }: Props) {
  const [participants, setParticipants] = useState<User[]>([]);
  const path = `/conversations/${c.display_id}/participants`;
  useEffect(() => {
    void http<User[]>(path)
      .then(setParticipants)
      .catch(() => setParticipants([]));
  }, [path]);
  const ids = participants.map((p) => p.id);
  const save = (userIds: number[]) =>
    void http<User[]>(path, 'PATCH', { user_ids: userIds })
      .then(setParticipants)
      .catch((e: Error) => onError(e.message));
  const joined = ids.includes(user.id);
  const available = catalog.agents.filter(
    (a) =>
      a.active && !ids.includes(a.id) && (a.role === 'administrator' || a.inbox_ids?.includes(c.inbox_id)),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-n-slate-11">
          {participants.length} participante{participants.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-n-blue-11 hover:underline"
          onClick={() => save(joined ? ids.filter((id) => id !== user.id) : [...ids, user.id])}
        >
          {joined ? 'Deixar de participar' : 'Participar'}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {participants.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm text-n-slate-12">
            <Avatar name={p.name} size={24} />
            <span className="flex-1 truncate">{p.name}</span>
            <Button
              color="slate"
              variant="ghost"
              size="xs"
              icon={X}
              aria-label={`Remover participante ${p.name}`}
              onClick={() => save(ids.filter((id) => id !== p.id))}
            />
          </li>
        ))}
      </ul>
      <Dropdown
        align="start"
        className="max-h-60 w-56 overflow-y-auto"
        trigger={({ toggle }) => (
          <Button
            color="slate"
            variant="faded"
            size="xs"
            icon={UserPlus}
            label="Adicionar participante"
            className="self-start"
            onClick={toggle}
          />
        )}
      >
        {(close) =>
          available.length === 0 ? (
            <p className="p-2 text-sm text-n-slate-11">Nenhum agente disponível.</p>
          ) : (
            available.map((a) => (
              <MenuItem
                key={a.id}
                label={a.name}
                onClick={() => {
                  close();
                  save([...ids, a.id]);
                }}
              />
            ))
          )
        }
      </Dropdown>
    </div>
  );
}
