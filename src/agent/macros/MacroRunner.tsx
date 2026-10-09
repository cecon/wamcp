import { useState } from 'react';
import { Play } from 'lucide-react';
import { http } from '../api';
import type { Macro } from '../accountTypes';
import type { Conversation } from '../types';
import { Button } from '../ui/Button';
import { executeMacro, useMacros, VISIBILITY_LABEL } from './useMacros';

interface Props {
  conversation: Conversation;
  onChange: (conversation: Conversation) => void;
}

/** Chatwoot conversation sidebar "Macros": run one on this conversation and show the outcome. */
export function MacroRunner({ conversation, onChange }: Props) {
  const { macros, loaded, error } = useMacros();
  const [running, setRunning] = useState<number | null>(null),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(macro: Macro) {
    setRunning(macro.id);
    setResult(null);
    try {
      const outcome = await executeMacro(macro, [conversation.display_id]);
      const failure = outcome.failed[0];
      setResult(
        failure
          ? { ok: false, text: `Falha ao executar “${macro.name}”: ${failure.error}` }
          : { ok: true, text: `Macro “${macro.name}” executada com sucesso.` },
      );
      onChange(await http<Conversation>(`/conversations/${conversation.display_id}`));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setRunning(null);
    }
  }

  if (error) return <p className="text-sm text-n-ruby-11">{error}</p>;
  if (loaded && macros.length === 0)
    return (
      <p className="text-sm text-n-slate-11">
        Nenhuma macro disponível. Crie macros em Configurações → Macros.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Macros disponíveis" className="flex flex-col gap-1">
        {macros.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-n-alpha-1">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-n-slate-12">{m.name}</span>
              <span className="text-xs text-n-slate-11">{VISIBILITY_LABEL[m.visibility]}</span>
            </span>
            <Button
              color="slate"
              variant="faded"
              size="xs"
              icon={Play}
              aria-label={`Executar ${m.name}`}
              title="Executar"
              disabled={running !== null}
              onClick={() => void run(m)}
            />
          </li>
        ))}
      </ul>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`text-sm ${result.ok ? 'text-n-teal-11' : 'text-n-ruby-11'}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
