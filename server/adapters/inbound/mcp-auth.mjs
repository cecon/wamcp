export function authChallenge(publicUrl, id, error = 'invalid_token', scope = 'whatsapp:read') {
  return `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(id)}", scope="${scope}", error="${error}", error_description="Autorize esta sessao no WA MCP"`;
}
export function authResult(challenge) {
  return {
    isError: true,
    content: [{ type: 'text', text: 'Autorize esta sessão no WA MCP para continuar.' }],
    _meta: { 'mcp/www_authenticate': [challenge] },
  };
}
export function toolSecurity(scope) {
  const securitySchemes = [
    { type: 'oauth2', scopes: scope === 'whatsapp:send' ? ['whatsapp:read', scope] : [scope] },
  ];
  return { securitySchemes, _meta: { securitySchemes } };
}
export function withToolSecurity(message) {
  if (!message.result?.tools) return message;
  // The SDK preserves extension metadata, but omits custom top-level tool fields.
  return {
    ...message,
    result: {
      ...message.result,
      tools: message.result.tools.map((tool) => ({ ...tool, securitySchemes: tool._meta?.securitySchemes })),
    },
  };
}
