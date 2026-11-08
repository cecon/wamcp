import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { http, upload } from '../api';
import type { Conversation, Message, User } from '../types';
import { PendingFiles, RecorderBar, ReplyToBar } from './composer/ComposerParts';
import { ComposerToolbar } from './composer/ComposerToolbar';
import { loadDraft, saveDraft, useTypingStatus } from './composer/composerState';
import { useSuggestions } from './composer/useSuggestions';
import { useVoiceRecorder } from './composer/useVoiceRecorder';
import { onComposerInsert } from './composer/composerBus';

interface Props {
  path: string;
  disabled: boolean;
  onSent: (message: Message) => void;
  /** Fills canned-response variables ({{contact.name}}, {{agent.name}}, ...). */
  conversation?: Conversation;
  user?: User;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  /** Agents offered by the "@" mention picker in private notes. */
  agents?: User[];
}

/**
 * Composer no C3Theme (lote 21): alternância Responder/Nota privada, editor, emoji, anexos, áudio e envio.
 * “/atalho” abre respostas prontas e “@” menciona agentes, como no CannedResponse.vue.
 */
export function ReplyBox({
  path,
  disabled,
  onSent,
  conversation,
  user,
  replyTo,
  onCancelReply,
  agents = [],
}: Props) {
  const [text, setText] = useState(() => loadDraft(path)),
    [note, setNote] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [caret, setCaret] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const typing = useTypingStatus(path, note);
  const recorder = useVoiceRecorder(setError);
  const blocked = disabled && !note;

  useEffect(() => saveDraft(path, text), [path, text]);
  useEffect(
    () =>
      onComposerInsert(path, (snippet) =>
        setText((t) => (t.trim() ? `${t.trimEnd()}\n${snippet}` : snippet)),
      ),
    [path],
  );

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const added = Array.from(list || []);
    if (added.length) setFiles((current) => [...current, ...added]);
  };
  // The caret moves right after React writes the new text (not a frame later), so fast typing
  // after picking a mention or a canned response lands where the person expects.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCaret.current;
    if (position === null) return;
    pendingCaret.current = null;
    area.current?.focus();
    area.current?.setSelectionRange(position, position);
  }, [text, caret]);
  function replaceText(next: string, position: number) {
    pendingCaret.current = position;
    setText(next);
    setCaret(position);
  }
  const suggestions = useSuggestions({ text, caret, note, agents, conversation, user, onText: replaceText });
  function insertAtCaret(snippet: string) {
    const el = area.current;
    const start = el?.selectionStart ?? text.length,
      end = el?.selectionEnd ?? text.length;
    replaceText(text.slice(0, start) + snippet + text.slice(end), start + snippet.length);
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
    const content = suggestions.content(text.trim());
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
    suggestions.reset();
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
    <Box
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      sx={{
        position: 'relative',
        mx: 1,
        mb: 1,
        borderRadius: 2,
        border: 1,
        borderColor: note ? 'warning.dark' : 'divider',
        bgcolor: note ? 'var(--color-n-solid-amber)' : 'background.paper',
      }}
    >
      {dragging && (
        <Box
          sx={{
            pointerEvents: 'none',
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'grid',
            placeContent: 'center',
            borderRadius: 2,
            border: 2,
            borderStyle: 'dashed',
            borderColor: 'primary.main',
            bgcolor: 'rgba(0,0,0,0.03)',
          }}
        >
          <Typography variant="body2" color="primary">
            Solte os arquivos para anexar
          </Typography>
        </Box>
      )}
      {suggestions.popup}
      <Box
        sx={{
          display: 'flex',
          height: 52,
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 1,
          pl: 1.5,
        }}
      >
        <Tabs
          value={note ? 'note' : 'reply'}
          onChange={(_event, value: string) => setNote(value === 'note')}
          sx={{ minHeight: 32, '& .MuiTabs-indicator': { display: 'none' } }}
        >
          <Tab
            value="reply"
            label="Responder"
            sx={{ minHeight: 32, py: 0, px: 1.25, textTransform: 'none', fontSize: 14 }}
          />
          <Tab
            value="note"
            label="Nota privada"
            sx={{ minHeight: 32, py: 0, px: 1.25, textTransform: 'none', fontSize: 14 }}
          />
        </Tabs>
      </Box>
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
          data-shortcut="composer"
          value={text}
          disabled={blocked}
          rows={3}
          maxLength={4096}
          aria-label={note ? 'Nota privada' : 'Mensagem'}
          placeholder={
            blocked
              ? 'Conversa resolvida. Reabra para responder ou escreva uma nota privada.'
              : note
                ? 'Esta nota é visível apenas para a equipe. Digite @ para mencionar um agente.'
                : "Shift + Enter para nova linha. Digite '/' para selecionar uma resposta pronta."
          }
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            if (e.target.value) typing.typing();
            else typing.stop();
          }}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            if (!images.length) return;
            e.preventDefault();
            addFiles(images);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (suggestions.onKeyDown(e)) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          style={{
            marginTop: 8,
            display: 'block',
            width: '100%',
            resize: 'none',
            background: 'transparent',
            border: 0,
            outline: 'none',
            padding: '0 12px',
            fontSize: 14,
            color: 'var(--color-n-slate-12)',
            fontFamily: 'inherit',
          }}
        />
      )}
      <ComposerToolbar
        note={note}
        blocked={blocked}
        recording={recorder.recording}
        busy={busy}
        error={error}
        canSend={canSend}
        onInsertEmoji={insertAtCaret}
        onAddFiles={addFiles}
        onRecord={() => void startRecording()}
        onSend={() => void send()}
      />
    </Box>
  );
}
