/** CSAT over WhatsApp: the survey asks for a 1–5 reply, and the answer is accepted for 24 hours. */
export const CSAT_WINDOW_SECONDS = 24 * 3600;
export const CSAT_SURVEY =
  'Como você avalia nosso atendimento? Responda com uma nota de 1 (ruim) a 5 (excelente).';
export const CSAT_THANKS = 'Obrigado pela avaliação!';

/** Accepts "5", "nota 4", "4 - foi ótimo"; returns { rating, feedback } or null. */
export function parseRating(text) {
  const match = /^\s*(?:nota\s*)?([1-5])(?:\s*(?:[-–:,.!]\s*)?(.*))?$/is.exec(String(text || ''));
  if (!match) return null;
  return { rating: Number(match[1]), feedback: match[2]?.trim() || null };
}

/** A resolved conversation whose survey is still open captures the reply instead of reopening. */
export function awaitingCsat(conversation, now) {
  return Boolean(
    conversation?.status === 'resolved' &&
    conversation.csat_requested_at &&
    now - conversation.csat_requested_at <= CSAT_WINDOW_SECONDS,
  );
}
