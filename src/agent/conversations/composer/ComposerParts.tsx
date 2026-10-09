import { useEffect, useMemo } from 'react';
import { FileText, Reply, Send, Trash2, X } from 'lucide-react';
import { humanSize } from '../../api';
import type { Message } from '../../types';
import { Button } from '../../ui/Button';
import { authorOf, snippet } from '../messageText';

/** Chatwoot ReplyBox "Replying to" banner above the editor. */
export function ReplyToBar({ message, onCancel }: { message: Message; onCancel: () => void }) {
  return (
    <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-n-alpha-black2 px-3 py-2 text-xs">
      <Reply size={14} className="shrink-0 text-n-slate-11" />
      <p className="min-w-0 flex-1 truncate text-n-slate-11">
        Respondendo a <span className="font-medium text-n-slate-12">{authorOf(message)}</span>:{' '}
        {snippet(message)}
      </p>
      <Button
        variant="ghost"
        color="slate"
        size="xs"
        icon={X}
        aria-label="Cancelar resposta"
        onClick={onCancel}
      />
    </div>
  );
}

function PendingFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const image = file.type.startsWith('image/');
  const url = useMemo(() => (image ? URL.createObjectURL(file) : ''), [file, image]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <li className="relative flex h-14 max-w-56 items-center gap-2 rounded-lg border border-n-weak bg-n-alpha-black2 pr-7 pl-1">
      {image ? (
        <img src={url} alt={file.name} className="size-12 rounded-md object-cover" />
      ) : (
        <FileText size={20} className="ml-2 shrink-0 text-n-slate-11" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs text-n-slate-12">{file.name}</span>
        <span className="block text-xxs text-n-slate-10">{humanSize(file.size)}</span>
      </span>
      <button
        type="button"
        aria-label={`Remover ${file.name}`}
        onClick={onRemove}
        className="absolute top-1 right-1 grid size-5 place-content-center rounded-full text-n-slate-11 hover:bg-n-alpha-2"
      >
        <X size={12} />
      </button>
    </li>
  );
}

/** Chatwoot AttachmentPreview: thumbnails of the files waiting to be sent. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return (
    <ul aria-label="Anexos" className="flex flex-wrap gap-2 px-3 pt-3">
      {files.map((file, i) => (
        <PendingFile key={`${file.name}-${i}`} file={file} onRemove={() => onRemove(i)} />
      ))}
    </ul>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Recording state of the voice note: elapsed time, discard and send. */
export function RecorderBar({
  elapsed,
  busy,
  onCancel,
  onSend,
}: {
  elapsed: number;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div role="group" aria-label="Gravando áudio" className="flex h-[4.5rem] items-center gap-3 px-3">
      <span className="size-2.5 animate-pulse rounded-full bg-n-ruby-9" aria-hidden />
      <span className="text-sm text-n-slate-12 tabular-nums" aria-label="Tempo de gravação">
        {clock(elapsed)}
      </span>
      <span className="flex-1 text-sm text-n-slate-11">Gravando áudio…</span>
      <Button variant="ghost" color="ruby" icon={Trash2} aria-label="Descartar áudio" onClick={onCancel} />
      <Button icon={Send} label="Enviar áudio" disabled={busy} onClick={onSend} />
    </div>
  );
}
