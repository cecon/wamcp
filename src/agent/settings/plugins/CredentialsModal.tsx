import { useState } from 'react';
import { http } from '../../api';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import type { Plugin } from './types';

interface Props {
  plugin: Plugin;
  onClose: () => void;
  onSaved: () => void;
}

/** Fills in the credentials a plugin declares. Stored values are never shown back: a blank
 * field keeps what is there, and "Apagar" clears it. */
export function CredentialsModal({ plugin, onClose, onSaved }: Props) {
  const credentials = plugin.manifest.credentials;
  const [values, setValues] = useState<Record<string, string>>({});
  const { error, busy, run } = useAction();
  const save = (name: string, value: string | null) =>
    http(`/plugins/${plugin.manifest.id}/credentials/${name}`, 'PUT', { value });

  return (
    <Modal
      title={`Credenciais de ${plugin.manifest.name}`}
      description="O app aplica a credencial na chamada da ferramenta; o modelo nunca a vê."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            for (const [name, value] of Object.entries(values)) {
              if (value.trim()) await save(name, value);
            }
            onSaved();
            onClose();
          });
        }}
      >
        {credentials.map((credential) => {
          const set = plugin.credentials_set.includes(credential.name);
          return (
            <label key={credential.name}>
              <span className="field-label">
                {credential.name} {set ? '(configurada)' : '(não configurada)'}
              </span>
              <span className="flex gap-2">
                <input
                  className="field font-mono"
                  type="password"
                  autoComplete="off"
                  placeholder={set ? 'Deixe em branco para manter' : ''}
                  value={values[credential.name] || ''}
                  onChange={(e) => setValues({ ...values, [credential.name]: e.target.value })}
                />
                {set && (
                  <button
                    type="button"
                    className="text-sm text-n-ruby-11"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await save(credential.name, null);
                        onSaved();
                        onClose();
                      })
                    }
                  >
                    Apagar
                  </button>
                )}
              </span>
              {credential.help && <span className="text-sm text-n-slate-11">{credential.help}</span>}
            </label>
          );
        })}
        <ModalFooter busy={busy} submit="Salvar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
