import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { http } from '../../api';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

/** Installs (or updates, same id) a plugin from its `plugin.json`, pasted or picked from disk. */
export function InstallModal({ onClose, onSaved }: Props) {
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const { error, busy, run } = useAction();

  return (
    <Modal
      title="Instalar plugin"
      description="Cole o plugin.json ou escolha o arquivo. Um plugin com o mesmo id é atualizado e mantém as credenciais."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            let manifest: unknown;
            try {
              manifest = JSON.parse(text);
            } catch {
              throw new Error('O manifesto não é um JSON válido');
            }
            await http('/plugins', 'POST', manifest);
            onSaved();
            onClose();
          });
        }}
      >
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="Arquivo plugin.json"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (chosen) void chosen.text().then(setText);
          }}
        />
        <div>
          <Button
            icon={FileUp}
            color="slate"
            variant="faded"
            label="Escolher plugin.json"
            onClick={() => file.current?.click()}
          />
        </div>
        <label>
          <span className="field-label">Manifesto</span>
          <textarea
            className="field font-mono"
            rows={14}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"id": "delivery", "name": "Delivery", "version": "1.0.0", "tools": [...]}'
          />
        </label>
        <ModalFooter busy={busy} submit="Instalar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
