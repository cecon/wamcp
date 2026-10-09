import { useState } from 'react';
import { Download, FileText, Mic } from 'lucide-react';
import { humanSize } from '../api';
import type { Attachment } from '../types';
import { Modal } from '../ui/Overlay';

const minutes = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Chatwoot GalleryView, reduced to one image with its download link. */
function ImageBubble({ attachment: a }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const name = a.file_name || 'Imagem';
  return (
    <>
      <button
        type="button"
        aria-label={`Abrir imagem ${name}`}
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-lg"
      >
        <img src={a.data_url} alt={name} loading="lazy" className="max-h-72 max-w-full object-cover" />
      </button>
      {open && (
        <Modal title={name} onClose={() => setOpen(false)}>
          <img src={a.data_url} alt={name} className="mx-auto max-h-[70vh] max-w-full rounded-lg" />
          <a
            href={a.data_url}
            download={a.file_name || true}
            className="mt-4 inline-flex items-center gap-2 text-sm text-n-blue-11 hover:underline"
          >
            <Download size={16} /> Baixar
          </a>
        </Modal>
      )}
    </>
  );
}

/** Chatwoot chips/File.vue: icon, truncated name, size and a download button. */
function FileChip({ attachment: a }: { attachment: Attachment }) {
  const name = a.file_name || 'Arquivo';
  return (
    <div className="flex h-11 max-w-full items-center gap-2 overflow-hidden rounded-lg border border-n-container bg-n-alpha-3 px-2">
      <FileText size={18} className="shrink-0 text-n-slate-11" />
      <span className="min-w-0 flex-1">
        <span className="block max-w-48 truncate text-sm text-n-slate-12" title={name}>
          {name}
        </span>
        {a.file_size != null && (
          <span className="block text-xs text-n-slate-10">{humanSize(a.file_size)}</span>
        )}
      </span>
      <a
        href={a.data_url}
        download={a.file_name || true}
        aria-label={`Baixar ${name}`}
        title="Baixar"
        className="grid size-8 shrink-0 place-content-center text-n-slate-11 hover:text-n-slate-12"
      >
        <Download size={16} />
      </a>
    </div>
  );
}

function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  if (a.file_type === 'image') return <ImageBubble attachment={a} />;
  if (a.file_type === 'sticker')
    return <img src={a.data_url} alt="Figurinha" loading="lazy" className="size-32 object-contain" />;
  if (a.file_type === 'audio')
    return (
      <div className="grid gap-1">
        {a.voice && (
          <span className="flex items-center gap-1 text-xs text-n-slate-11">
            <Mic size={12} /> Mensagem de voz{a.duration ? ` · ${minutes(a.duration)}` : ''}
          </span>
        )}
        <audio
          controls
          preload="metadata"
          src={a.data_url}
          aria-label={a.voice ? 'Mensagem de voz' : 'Áudio'}
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  if (a.file_type === 'video')
    return (
      <video
        controls
        preload="metadata"
        src={a.data_url}
        aria-label="Vídeo"
        className="max-h-72 max-w-full rounded-lg"
      >
        <track kind="captions" />
      </video>
    );
  return <FileChip attachment={a} />;
}

export function Attachments({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-2 grid gap-2">
      {items.map((a) => (
        <AttachmentView key={a.id} attachment={a} />
      ))}
    </div>
  );
}
