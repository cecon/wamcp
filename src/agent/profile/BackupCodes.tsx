import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { copyText, saveTextFile } from './browser';

/** The 10 one-time backup codes, shown once right after enabling two-factor authentication. */
export function BackupCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <Modal
      title="Salve seus códigos de recuperação"
      description="Cada código pode ser usado uma única vez caso você perca o acesso ao aplicativo autenticador. Você não poderá vê-los novamente."
      onClose={onClose}
    >
      <ul aria-label="Códigos de recuperação" className="grid grid-cols-2 gap-2 rounded-xl bg-n-alpha-1 p-4">
        {codes.map((code) => (
          <li key={code} className="text-center font-mono text-sm text-n-slate-12">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 pt-6">
        <Button
          color="slate"
          variant="faded"
          icon={Copy}
          label={copied ? 'Copiados' : 'Copiar todos'}
          onClick={() => void copyText(text).then(setCopied)}
        />
        <Button
          color="slate"
          variant="faded"
          icon={Download}
          label="Baixar"
          onClick={() => saveTextFile('wamcp-codigos-de-recuperacao.txt', `${text}\n`)}
        />
        <Button label="Concluir" onClick={onClose} />
      </div>
    </Modal>
  );
}
