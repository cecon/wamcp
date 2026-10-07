import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Mic, Paperclip } from 'lucide-react';
import { http, upload } from '../api';
import type { Canned, Conversation, Message, User } from '../types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { PendingFiles, RecorderBar, ReplyToBar } from './composer/ComposerParts';
import { CannedList, EmojiPicker } from './composer/ComposerPickers';
import { fillVariables, loadDraft, saveDraft, useCanned, useTypingStatus } from './composer/composerState';
import { useVoiceRecorder } from './composer/useVoiceRecorder';

interface Props {
  path: string;
  disabled: boolean;
  onSent: (message: Message) => void;
  /** Fills canned-response variables ({{contact.name}}, {{agent.name}}, ...). */
  conversation?: Conversation;
  user?: User;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

const ICON =
  'grid size-8 place-content-center rounded-lg text-n-slate-11 hover:bg-n-alpha-2 disabled:pointer-events-none disabled:opacity-50';

/**
 * Chatwoot ReplyBox: Reply / Private Note pill toggle, editor, bottom panel with emoji, attachments,
 * voice note and Send. Typing "/shortcut" opens the canned responses picker, like CannedResponse.vue.
 */
export function ReplyBox({ path, disabled, onSent, conversation, user, replyTo, onCancelReply }: Props) {
  const [text, setText] = useState(() => loadDraft(path)),
    [note, setNote] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null);
  const shortcut = /^\/(\S*)$/.exec(text)?.[1];
  const { options, highlight, setHighlight } = useCanned(shortcut);
  const typing = useTypingStatus(path, note);
  const recorder = useVoiceRecorder(setError);
  const blocked = disabled && !note;

  useEffect(() => saveDraft(path, text), [path, text]);

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const added = Array.from(list || []);
    if (added.length) setFiles((current) => [...current, ...added]);
  };
  const pickCanned = (c: Canned) => setText(fillVariables(c.content, conversation, user));
  function insertAtCaret(snippet: string) {
    const el = area.current;
    const start = el?.selectionStart ?? text.length,
      end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + snippet + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function deliver(request: () => Promise<Message | Message[]>) {
    setBusy(true);
    setError('');
    typing.stop();
    try {
      const result = await request();
      for (const m of Array.isArray(result) ? result : [result]) onSent(m);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const form = (content: string, attachments: File[], voice = false) => {
    const data = new FormData();
    data.append('content', content);
    data.append('private', String(note));
    if (replyTo) data.append('in_reply_to', String(replyTo.id));
    if (voice) data.append('voice', 'true');
    for (const file of attachments) data.append('attachments[]', file);
    return data;
  };

  async function send() {
    const content = text.trim();
    if ((!content && !files.length) || busy || blocked) return;
    const ok = await deliver(() =>
      files.length
        ? upload<Message | Message[]>(`${path}/messages`, form(content, files))
        : http<Message>(`${path}/messages`, 'POST', {
            content,
            private: note,
            ...(replyTo ? { in_reply_to: replyTo.id } : {}),
          }),
    );
    if (!ok) return;
    setText('');
    setFiles([]);
    onCancelReply?.();
  }
  async function startRecording() {
    if (await recorder.start()) typing.recording();
  }
  async function sendVoice() {
    const audio = await recorder.finish();
    if (!audio) return;
    if (await deliver(() => upload<Message | Message[]>(`${path}/messages`, form('', [audio], true))))
      onCancelReply?.();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!blocked) addFiles(e.dataTransfer.files);
  };
  const canSend = (Boolean(text.trim()) || files.length > 0) && !busy && !blocked;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        'relative mx-2 mb-2 rounded-xl border',
        note ? 'border-n-amber-12/5 bg-n-solid-amber' : 'border-n-weak bg-n-solid-1',
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-content-center rounded-xl border-2 border-dashed border-n-brand bg-n-solid-1/90 text-sm text-n-blue-11">
          Solte os arquivos para anexar
        </div>
      )}
      {options.length > 0 && (
        <CannedList
          shortcut={shortcut || ''}
          options={options}
          highlight={highlight}
          onHighlight={setHighlight}
          onPick={pickCanned}
        />
      )}
      <div className="flex h-[3.25rem] items-center justify-between pr-2 pl-3">
        <div
          role="tablist"
          className="relative flex h-8 items-center rounded-full border border-n-weak bg-n-alpha-2 p-1 text-sm"
        >
          {[
            [false, 'Responder'],
            [true, 'Nota privada'],
          ].map(([isNote, label]) => (
            <button
              key={String(label)}
              type="button"
              role="tab"
              aria-selected={note === isNote}
              onClick={() => setNote(Boolean(isNote))}
              className={cn(
                'h-6 rounded-full px-2 transition-colors',
                note === isNote ? 'bg-n-solid-1 font-medium text-n-slate-12 shadow-sm' : 'text-n-slate-11',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {replyTo && onCancelReply && <ReplyToBar message={replyTo} onCancel={onCancelReply} />}
      <PendingFiles files={files} onRemove={(i) => setFiles((list) => list.filter((_, j) => j !== i))} />
      {recorder.recording ? (
        <RecorderBar
          elapsed={recorder.elapsed}
          busy={busy}
          onCancel={() => {
            recorder.cancel();
            typing.stop();
          }}
          onSend={() => void sendVoice()}
        />
      ) : (
        <textarea
          ref={area}
          value={text}
          disabled={blocked}
          rows={3}
          maxLength={4096}
          aria-label={note ? 'Nota privada' : 'Mensagem'}
          placeholder={
            blocked
              ? 'Conversa resolvida. Reabra para responder ou escreva uma nota privada.'
              : note
                ? 'Esta nota é visível apenas para a equipe.'
                : "Shift + Enter para nova linha. Digite '/' para selecionar uma resposta pronta."
          }
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) typing.typing();
            else typing.stop();
          }}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            if (!images.length) return;
            e.preventDefault();
            addFiles(images);
          }}
          onKeyDown={(e) => {
            if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
            } else if (options.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              pickCanned(options[highlight]);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="mt-2 block w-full resize-none bg-transparent px-3 text-sm text-n-slate-12 outline-none placeholder:text-n-slate-10 disabled:cursor-not-allowed"
        />
      )}
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-1">
          <EmojiPicker onPick={insertAtCaret} disabled={blocked || recorder.recording} />
          <button
            type="button"
            aria-label="Anexar arquivos"
            title="Anexar arquivos"
            disabled={blocked || recorder.recording}
            onClick={() => picker.current?.click()}
            className={ICON}
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {!note && (
            <button
              type="button"
              aria-label="Gravar áudio"
              title="Gravar áudio"
              disabled={blocked || recorder.recording || busy}
              onClick={() => void startRecording()}
              className={ICON}
            >
              <Mic size={16} />
            </button>
          )}
          <span className="ml-2 truncate text-xs text-n-ruby-11">{error}</span>
        </div>
        <Button
          color={note ? 'amber' : 'blue'}
          label={note ? 'Adicionar nota (↵)' : 'Enviar (↵)'}
          disabled={!canSend || recorder.recording}
          onClick={() => void send()}
        />
      </div>
    </div>
  );
}
