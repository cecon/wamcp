//! The consent page shown by `/authorize`: the user pastes the code generated in the desktop app.
use crate::application::oauth::Pending;
use axum::http::{header, HeaderValue};
use axum::response::{Html, IntoResponse, Response};

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const STYLE: &str = "body{font:16px system-ui;background:#f4f8f6;color:#163c32;margin:0;padding:32px}main{max-width:520px;margin:6vh auto;background:white;padding:32px;border-radius:16px}label,input,button{display:block;margin-top:20px}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #abc;border-radius:8px}button{background:#07865f;color:white;border:0;border-radius:8px;padding:14px 24px;cursor:pointer}p{line-height:1.6}small{color:#576b64}.error{color:#ac2727}";

pub fn consent_page(request: &str, pending: &Pending) -> Response {
    let permissions = if pending.scopes.iter().any(|s| s == "whatsapp:send") {
        "leitura de conversas e envio de mensagens"
    } else {
        "leitura de conversas"
    };
    let origin = url::Url::parse(&pending.redirect_uri)
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default();
    let page = format!(
        "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Autorizar WA MCP</title><style>{STYLE}</style><main><h1>Conectar ao ChatGPT</h1><p>O cliente <strong>{client}</strong> solicita acesso a uma sessão do WhatsApp.</p><p>Permissões solicitadas: <strong>{permissions}</strong>. O limite escolhido no aplicativo sempre será respeitado.</p><p>No WA MCP, abra a sessão desejada → Acesso MCP → ChatGPT e gere um código temporário. Autorize apenas uma conexão que você iniciou.</p><small>Sessão: {session}<br>Retorno: {origin}</small><form method=\"post\" action=\"/oauth/approve\"><input type=\"hidden\" name=\"request\" value=\"{request}\"><label for=\"code\">Código temporário do aplicativo</label><input id=\"code\" name=\"code\" required maxlength=\"64\" autocomplete=\"off\" spellcheck=\"false\"><button type=\"submit\">Autorizar conexão</button></form><p><small>Para cancelar, feche esta página. Você pode revogar o acesso no aplicativo a qualquer momento.</small></p></main></html>",
        client = escape(&pending.client_name),
        session = escape(&pending.session_id),
        origin = escape(&origin),
        request = escape(request),
    );
    let csp = format!(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' {}; base-uri 'none'; frame-ancestors 'none'",
        pending.redirect_uri
    );
    let mut response = Html(page).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("same-origin"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    if let Ok(value) = HeaderValue::from_str(&csp) {
        headers.insert(header::CONTENT_SECURITY_POLICY, value);
    }
    response
}
