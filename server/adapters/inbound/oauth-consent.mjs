const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function consentPage(res, pending, error = '') {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${pending.redirectUri}; base-uri 'none'; frame-ancestors 'none'`,
  });
  return res
    .type('html')
    .send(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar WA MCP</title><style>body{font:16px system-ui;background:#f4f8f6;color:#163c32;margin:0;padding:32px}main{max-width:520px;margin:6vh auto;background:white;padding:32px;border-radius:16px}label,input,button{display:block;margin-top:20px}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #abc;border-radius:8px}button{background:#07865f;color:white;border:0;border-radius:8px;padding:14px 24px;cursor:pointer}p{line-height:1.6}small{color:#576b64}.error{color:#ac2727}</style><main><h1>Conectar ao ChatGPT</h1><p>O cliente <strong>${escape(pending.clientName)}</strong> solicita acesso a uma sessão do WhatsApp.</p><p>Permissões solicitadas: <strong>${pending.scopes.includes('whatsapp:send') ? 'leitura de conversas e envio de mensagens' : 'leitura de conversas'}</strong>. O limite escolhido no aplicativo sempre será respeitado.</p><p>No WA MCP, abra a sessão desejada → Acesso MCP → ChatGPT e gere um código temporário. Autorize apenas uma conexão que você iniciou.</p><small>Sessão: ${escape(pending.sessionId)}<br>Retorno: ${escape(new URL(pending.redirectUri).origin)}</small>${error ? `<p class="error">${escape(error)}</p>` : ''}<form method="post" action="/oauth/approve"><input type="hidden" name="request" value="${escape(pending.request)}"><label for="code">Código temporário do aplicativo</label><input id="code" name="code" required maxlength="64" autocomplete="off" spellcheck="false"><button type="submit">Autorizar conexão</button></form><p><small>Para cancelar, feche esta página. Você pode revogar o acesso no aplicativo a qualquer momento.</small></p></main></html>`,
    );
}
