export const EVENT_TTL = 24 * 60 * 60 * 1000;
export const ROTATION_WINDOW = 5 * 60 * 1000;
export const MAX_EVENT_TEXT = 8000;
const jidPattern = /^[0-9][0-9A-Za-z:._-]*@(s\.whatsapp\.net|g\.us|lid)$/;

export class EventError extends Error {
  constructor(message, code = -32602, reason) {
    super(message);
    this.name = 'EventError';
    this.code = code;
    if (reason) this.data = { reason };
  }
}

export const eventDefinition = {
  name: 'message.created',
  description:
    'Uma nova mensagem recebida no WhatsApp, opcionalmente filtrada por conversa. Não inclui histórico nem mensagens enviadas por esta conta.',
  delivery: ['webhook'],
  inputSchema: {
    type: 'object',
    properties: { jid: { type: 'string', pattern: jidPattern.source } },
    additionalProperties: false,
  },
  payloadSchema: {
    type: 'object',
    properties: {
      jid: { type: 'string' },
      message_id: { type: 'string' },
      sender: { type: 'string' },
      text: { type: 'string', maxLength: MAX_EVENT_TEXT },
      kind: { type: 'string' },
      from_me: { type: 'boolean', const: false },
      timestamp: { type: 'string', format: 'date-time' },
      truncated: { type: 'boolean' },
    },
    required: ['jid', 'message_id', 'sender', 'text', 'kind', 'from_me', 'truncated'],
    additionalProperties: false,
  },
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function eventParameters(params, subscribing = true) {
  if (!object(params) || params.name !== eventDefinition.name) throw new EventError('Evento não suportado');
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!object(args) || Object.keys(args).some((key) => key !== 'jid'))
    throw new EventError('Argumentos de evento inválidos');
  if (
    args.jid !== undefined &&
    (typeof args.jid !== 'string' || args.jid.length > 200 || !jidPattern.test(args.jid))
  )
    throw new EventError('Conversa inválida');
  const delivery = params.delivery;
  if (
    !object(delivery) ||
    delivery.mode !== 'webhook' ||
    typeof delivery.url !== 'string' ||
    delivery.url.length > 2048
  )
    throw new EventError('Entrega webhook inválida');
  let url;
  try {
    url = new URL(delivery.url);
  } catch {
    throw new EventError('URL de callback inválida');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new EventError('Callback deve usar HTTPS sem credenciais ou fragmento');
  if (subscribing) {
    const secret = delivery.secret;
    if (typeof secret !== 'string' || secret.length > 94 || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))
      throw new EventError('Segredo de assinatura inválido');
    let bytes;
    try {
      const decoded = atob(secret.slice(6));
      if (btoa(decoded) !== secret.slice(6)) throw new Error('base64');
      bytes = decoded.length;
    } catch {
      throw new EventError('Segredo de assinatura inválido');
    }
    if (bytes < 24 || bytes > 64) throw new EventError('Segredo de assinatura deve conter 24–64 bytes');
    if (params.cursor !== undefined && params.cursor !== null)
      throw new EventError('Este evento não oferece replay; cursor deve ser null');
    if (
      params.ttlMs !== undefined &&
      params.ttlMs !== null &&
      (!Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0)
    )
      throw new EventError('ttlMs deve ser um inteiro positivo ou null');
  }
  return {
    name: eventDefinition.name,
    args: args.jid === undefined ? {} : { jid: args.jid },
    url: url.href,
    ...(subscribing ? { secret: delivery.secret, ttl: Math.min(params.ttlMs ?? EVENT_TTL, EVENT_TTL) } : {}),
  };
}

export function eventOwner(owner) {
  if (
    !object(owner) ||
    !['token', 'oauth'].includes(owner.principalKind) ||
    !['sessionId', 'principalId'].every(
      (key) => typeof owner[key] === 'string' && owner[key].length > 0 && owner[key].length <= 200,
    )
  )
    throw new EventError('Identidade de evento inválida', -32001);
  return { sessionId: owner.sessionId, principalId: owner.principalId, principalKind: owner.principalKind };
}

export function subscriptionIdentity(owner, params) {
  return JSON.stringify([
    owner.sessionId,
    owner.principalKind,
    owner.principalId,
    params.url,
    params.name,
    params.args,
  ]);
}

export function messageEvent(sessionId, message, now, hash) {
  if (!object(message) || (message.from_me !== false && message.from_me !== 0)) return null;
  const jid = message.jid;
  const id = message.message_id ?? message.id;
  if (
    typeof jid !== 'string' ||
    jid.length > 200 ||
    !jidPattern.test(jid) ||
    typeof id !== 'string' ||
    !id ||
    id.length > 300
  )
    return null;
  const text = String(message.text ?? message.body ?? '');
  const timestamp = message.timestamp ?? (Number.isFinite(message.ts) ? message.ts * 1000 : now);
  const date = new Date(timestamp);
  const occurred = Number.isNaN(date.getTime()) ? new Date(now).toISOString() : date.toISOString();
  return {
    eventId: `evt_${hash(JSON.stringify([sessionId, jid, id]))}`,
    name: eventDefinition.name,
    timestamp: occurred,
    data: {
      jid,
      message_id: id,
      sender: String(message.sender ?? jid).slice(0, 300),
      text: text.slice(0, MAX_EVENT_TEXT),
      kind: String(message.kind ?? 'unknown').slice(0, 100),
      from_me: false,
      timestamp: occurred,
      truncated: text.length > MAX_EVENT_TEXT,
    },
    cursor: null,
  };
}

export function retryable(status) {
  return status === undefined || status === 0 || status === 408 || status === 429 || status >= 500;
}
