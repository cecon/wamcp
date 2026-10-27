import { useEffect } from 'react';
import type { RuntimeStatus } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { RUNTIMES } from './labels';

interface Props {
  value: string;
  onChange: (runtime: string) => void;
  /** New agents start on an installed runtime. */
  pickInstalled: boolean;
}

const INSTALL: Record<string, string> = {
  claude_cli: 'Instale o Claude Code e entre com a sua conta (comando claude).',
  codex_cli: 'Instale com npm install -g @openai/codex e entre com codex login.',
  openclaude: 'Instale com npm install -g @gitlawb/openclaude.',
};

/** The AI agent's runtime, marking the ones not installed on this computer. */
export function RuntimeSelect({ value, onChange, pickInstalled }: Props) {
  const { data } = useFetch<RuntimeStatus[]>('/agent_runtimes');
  const status = (id: string) => data?.find((r) => r.id === id);
  const current = status(value);
  const firstInstalled = data?.find((r) => r.available)?.id;
  useEffect(() => {
    if (pickInstalled && current && !current.available && firstInstalled) onChange(firstInstalled);
  }, [pickInstalled, current, firstInstalled, onChange]);

  return (
    <div>
      <label>
        <span className="field-label">Runtime</span>
        <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
          {RUNTIMES.map((r) => {
            const missing = status(r.value)?.available === false;
            return (
              <option key={r.value} value={r.value} disabled={missing && r.value !== value}>
                {missing ? `${r.label} — não instalado` : r.label}
              </option>
            );
          })}
        </select>
      </label>
      {current && (
        <span className={`mt-1 block text-xs ${current.available ? 'text-n-slate-11' : 'text-n-ruby-11'}`}>
          {current.available
            ? `Encontrado em ${current.detail}`
            : `Não instalado neste computador. ${INSTALL[value] ?? ''}`}
          {value === 'openclaude' &&
            ' Usa um modelo do OpenRouter com a credencial OPENROUTER_API_KEY deste agente.'}
        </span>
      )}
    </div>
  );
}
