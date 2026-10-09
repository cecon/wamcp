import { useState } from 'react';
import { upload } from '../api';
import type { ImportResult } from '../types';
import { useAction } from '../settings/useAction';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';

/** Chatwoot "Importar contatos": CSV with name, phone_number, email, identifier; updates by phone. */
export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<ImportResult | null>(null);
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Importar contatos"
      description="Envie um CSV com o cabeçalho name, phone_number, email, identifier. Contatos com o mesmo telefone são atualizados."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          void run(async () => {
            const form = new FormData();
            form.append('import_file', file);
            setResult(await upload<ImportResult>('/contacts/import', form));
            onImported();
          });
        }}
      >
        <label>
          <span className="field-label">Arquivo CSV</span>
          <input
            className="field"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {result && (
          <div role="status" className="mt-4 text-sm text-n-slate-12">
            <p>
              {result.created} criado(s), {result.updated} atualizado(s), {result.failed.length} com erro.
            </p>
            <ul className="mt-2 text-n-ruby-11">
              {result.failed.map((f) => (
                <li key={f.line}>
                  Linha {f.line}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ModalFooter busy={busy || !file} submit="Importar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
