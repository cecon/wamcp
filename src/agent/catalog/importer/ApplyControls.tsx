import { useState } from 'react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { cn } from '../../ui/cn';

type Mode = 'merge' | 'replace';
const WORD = 'SUBSTITUIR';

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: 'merge',
    label: 'Mesclar com o cardápio atual',
    description:
      'Atualiza o que já veio do iFood (pelo id do iFood ou código PDV) e cria o resto. Nada é apagado.',
  },
  {
    value: 'replace',
    label: 'Substituir tudo',
    description: 'Apaga todo o cardápio atual (categorias, itens e complementos) e grava o importado.',
  },
];

interface Props {
  busy: boolean;
  onApply: (mode: Mode) => void;
}

/** Choose merge or replace; replacing asks the administrator to type SUBSTITUIR. */
export function ApplyControls({ busy, onApply }: Props) {
  const [mode, setMode] = useState<Mode>('merge'),
    [confirming, setConfirming] = useState(false),
    [typed, setTyped] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="field-label">Como aplicar</legend>
        {MODES.map((m) => (
          <label
            key={m.value}
            className={cn(
              'flex cursor-pointer gap-2 rounded-xl p-3 outline outline-1 -outline-offset-1',
              mode === m.value
                ? m.value === 'replace'
                  ? 'outline-n-ruby-9'
                  : 'outline-n-brand'
                : 'outline-n-weak',
            )}
          >
            <input
              type="radio"
              name="import-mode"
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            <span>
              <span className="block text-sm font-medium text-n-slate-12">{m.label}</span>
              <span className="block text-xs text-n-slate-11">{m.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button
        color={mode === 'replace' ? 'ruby' : 'blue'}
        label="Aplicar importação"
        className="self-start"
        disabled={busy}
        onClick={() => (mode === 'replace' ? setConfirming(true) : onApply('merge'))}
      />
      {confirming && (
        <Modal
          title="Substituir todo o cardápio?"
          description="Todas as categorias, itens e complementos atuais serão apagados e trocados pelo cardápio importado. Esta ação não pode ser desfeita."
          onClose={() => setConfirming(false)}
        >
          <label className="block">
            <span className="field-label">Digite {WORD} para confirmar</span>
            <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 pt-4">
            <Button color="slate" variant="faded" label="Cancelar" onClick={() => setConfirming(false)} />
            <Button
              color="ruby"
              label="Substituir cardápio"
              disabled={typed.trim().toUpperCase() !== WORD || busy}
              onClick={() => {
                setConfirming(false);
                onApply('replace');
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
