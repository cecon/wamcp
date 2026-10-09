import { useEffect, useRef, useState } from 'react';

const OGG = 'audio/ogg;codecs=opus';
const WEBM = 'audio/webm;codecs=opus';

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  tick: ReturnType<typeof setInterval>;
}

/** WhatsApp plays Opus voice notes natively, so OGG/Opus is preferred over WebM when available. */
function pickMime() {
  const supported = (type: string) => MediaRecorder.isTypeSupported?.(type) ?? false;
  if (supported(OGG)) return OGG;
  return supported(WEBM) ? WEBM : '';
}

/** Chatwoot AudioRecorder (MediaRecorder): start, elapsed seconds, cancel or finish into a File. */
export function useVoiceRecorder(onError: (message: string) => void) {
  const [recording, setRecording] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const session = useRef<{ current: Session | null }>({ current: null });

  function release() {
    const s = session.current.current;
    session.current.current = null;
    if (!s) return;
    clearInterval(s.tick);
    s.stream.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setElapsed(0);
  }

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError('Gravação de áudio não é suportada neste navegador.');
      return false;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Não foi possível acessar o microfone.');
      return false;
    }
    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    session.current.current = { recorder, stream, chunks, tick };
    recorder.start();
    setElapsed(0);
    setRecording(true);
    return true;
  }

  function cancel() {
    const s = session.current.current;
    if (s && s.recorder.state !== 'inactive') {
      s.recorder.onstop = null;
      s.recorder.stop();
    }
    release();
  }

  function finish() {
    const s = session.current.current;
    if (!s) return Promise.resolve(null);
    return new Promise<File>((resolve) => {
      s.recorder.onstop = () => {
        const type = s.recorder.mimeType || pickMime() || 'audio/webm';
        const extension = type.includes('ogg') ? 'ogg' : 'webm';
        release();
        resolve(new File(s.chunks, `audio.${extension}`, { type }));
      };
      s.recorder.stop();
    });
  }

  useEffect(() => {
    const box = session.current;
    return () => {
      const s = box.current;
      if (!s) return;
      clearInterval(s.tick);
      if (s.recorder.state !== 'inactive') s.recorder.stop();
      s.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { recording, elapsed, start, cancel, finish };
}
