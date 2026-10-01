export function canSend(scope) {
  return scope === 'read_write';
}
export function requireSession(session) {
  if (!session) throw new Error('Sessão não encontrada');
  return session;
}
export function requireSendPermission(token, sessionId) {
  if (!token || token.session_id !== sessionId || !canSend(token.scope)) {
    throw new Error('Credencial sem permissão de envio nesta sessão');
  }
}
