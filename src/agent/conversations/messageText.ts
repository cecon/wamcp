import type { AttachmentType, Message } from '../types';

const MEDIA: Record<AttachmentType, string> = {
  image: '📷 Imagem',
  audio: '🎵 Áudio',
  video: '🎥 Vídeo',
  file: '📄 Arquivo',
  sticker: 'Figurinha',
};

/** Who wrote a message, as shown above the bubble. */
export function authorOf(m: Message) {
  if (m.message_type === 'incoming') return m.sender_name || 'Contato';
  return (
    m.sender_name ||
    m.content_attributes.automated ||
    (m.sender_type === 'system' ? 'Pelo celular' : 'Equipe')
  );
}

/** One-line preview (quotes, the reply-to bar): text, or the kind of media it carries. */
export function snippet(m: Message) {
  if (m.content_attributes.deleted) return 'Esta mensagem foi apagada';
  const text = (m.content || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const first = m.attachments?.[0];
  if (!first) return '';
  return first.voice ? '🎤 Mensagem de voz' : MEDIA[first.file_type];
}
