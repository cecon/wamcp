//! OAuth flow helpers shared by the OAuth tests (port of `tests/oauth-fixture.mjs`).
#![allow(dead_code)]
pub mod golden;
use crate::common::http::{request, send, Reply};
use crate::common::{Fixture, ADMIN_TOKEN, ORIGIN};
use axum::body::Body;
use axum::http::Request;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use wamcp_server::application::oauth::OAuthService;
use wamcp_server::domain::model::Session;

pub const CALLBACK: &str = "https://chatgpt.com/connector/oauth/test-client";

pub type Form = Vec<(String, String)>;

pub struct Flow {
    pub f: Fixture,
    pub a: Session,
    pub b: Session,
    pub resource: String,
}

/// The consent page of `/authorize`, the opaque request id it embeds and the PKCE verifier used.
pub struct Begun {
    pub reply: Reply,
    pub request: Option<String>,
    pub verifier: String,
}

pub fn pairs(items: &[(&str, &str)]) -> Form {
    items.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// `base` with the keys of `changes` replaced (or appended).
pub fn with(base: &Form, changes: &[(&str, &str)]) -> Form {
    let mut out = base.clone();
    for (key, value) in changes {
        match out.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = value.to_string(),
            None => out.push((key.to_string(), value.to_string())),
        }
    }
    out
}

pub fn encode(form: &Form) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in form {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

pub fn pkce() -> (String, String) {
    let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn query_param(location: &str, name: &str) -> Option<String> {
    let url = url::Url::parse(location).ok()?;
    url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned())
}

impl Flow {
    pub async fn new() -> Self {
        let f = Fixture::new().await;
        let (a, b) = (f.session("Session A"), f.session("Session B"));
        let resource = format!("{ORIGIN}/mcp/{}", a.id);
        Self { f, a, b, resource }
    }

    pub fn oauth(&self) -> &OAuthService {
        self.f.app.state.oauth.as_ref().expect("oauth enabled")
    }

    pub async fn get(&self, path: &str, headers: &[(&str, &str)]) -> Reply {
        self.f.public(request("GET", path, None, headers)).await
    }

    /// A form-encoded POST to the public listener.
    pub async fn form(&self, path: &str, form: &Form, headers: &[(&str, &str)]) -> Reply {
        let mut builder = Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "wamcp.test")
            .header("content-type", "application/x-www-form-urlencoded");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        self.f
            .public(builder.body(Body::from(encode(form))).expect("request"))
            .await
    }

    pub async fn approve_form(&self, form: &Form, origin: &str) -> Reply {
        self.form("/oauth/approve", form, &[("origin", origin)]).await
    }

    /// Registers a client like the fixture: public ChatGPT client unless `overrides` say otherwise.
    pub async fn register(&self, overrides: Value) -> Reply {
        let mut body = json!({
            "client_name": "ChatGPT test",
            "redirect_uris": [CALLBACK],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        });
        for (key, value) in overrides.as_object().cloned().unwrap_or_default() {
            body[key] = value;
        }
        self.f.public(request("POST", "/register", Some(body), &[])).await
    }

    /// Opens `/authorize`; `changes` replace parameters and `None` removes one.
    pub async fn begin(&self, client_id: &str, changes: &[(&str, Option<&str>)]) -> Begun {
        let (verifier, challenge) = pkce();
        let mut params = pairs(&[
            ("client_id", client_id),
            ("redirect_uri", CALLBACK),
            ("response_type", "code"),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
            ("scope", "whatsapp:read whatsapp:send"),
            ("state", "state-to-preserve"),
            ("resource", &self.resource),
        ]);
        for (key, value) in changes {
            params.retain(|(k, _)| k != key);
            if let Some(value) = value {
                params.push((key.to_string(), value.to_string()));
            }
        }
        let reply = self.get(&format!("/authorize?{}", encode(&params)), &[]).await;
        let request = reply
            .text
            .split("name=\"request\" value=\"")
            .nth(1)
            .and_then(|r| r.split('"').next());
        Begun {
            request: request.map(String::from),
            reply,
            verifier,
        }
    }

    /// A desktop link code for session A (through the admin listener).
    pub async fn link(&self, scope: &str) -> String {
        let path = format!("/api/sessions/{}/chatgpt/link", self.a.id);
        let reply = self.f.admin("POST", &path, Some(json!({ "scope": scope }))).await;
        assert_eq!(reply.status, 200, "link: {}", reply.text);
        reply.body["code"].as_str().expect("link code").to_string()
    }

    /// Full consent; returns the authorization_code token request body.
    pub async fn approve(&self, client_id: &str, scope: &str) -> Form {
        let flow = self.begin(client_id, &[]).await;
        assert_eq!(flow.reply.status, 200, "{}", flow.reply.text);
        let code = self.link(scope).await;
        let request = flow.request.clone().unwrap_or_default();
        let approved = self
            .approve_form(&pairs(&[("request", &request), ("code", &code)]), ORIGIN)
            .await;
        assert_eq!(approved.status, 303, "{}", approved.text);
        let location = approved.header("location").unwrap_or_default();
        assert_eq!(query_param(&location, "state").as_deref(), Some("state-to-preserve"));
        let code = query_param(&location, "code").unwrap_or_default();
        pairs(&[
            ("code", &code),
            ("code_verifier", &flow.verifier),
            ("client_id", client_id),
            ("redirect_uri", CALLBACK),
            ("resource", &self.resource),
            ("grant_type", "authorization_code"),
        ])
    }

    pub async fn token(&self, form: &Form) -> Reply {
        self.form("/token", form, &[]).await
    }

    /// A JSON-RPC call to `/mcp/{session}`: `tools/list`, or `tools/call` of `name` with `args`.
    pub async fn rpc_with(&self, token: &str, name: &str, session: &Session, args: Value) -> Reply {
        let params = if name == "tools/list" {
            json!({})
        } else {
            json!({ "name": name, "arguments": args })
        };
        let method = if name == "tools/list" { name } else { "tools/call" };
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let auth = format!("Bearer {token}");
        let headers = [
            ("authorization", auth.as_str()),
            ("accept", "application/json, text/event-stream"),
        ];
        self.f
            .public(request("POST", &format!("/mcp/{}", session.id), Some(body), &headers))
            .await
    }

    pub async fn rpc(&self, token: &str, name: &str) -> Reply {
        self.rpc_with(token, name, &self.a, json!({})).await
    }

    pub async fn admin_with(&self, method: &str, path: &str, headers: &[(&str, &str)]) -> Reply {
        let auth = format!("Bearer {ADMIN_TOKEN}");
        let mut all = vec![("authorization", auth.as_str())];
        all.extend_from_slice(headers);
        send(&self.f.app.admin_router(), request(method, path, None, &all)).await
    }

    /// Runs SQL on the fixture database (expiring rows like the Node tests do).
    pub fn sql(&self, sql: &str) {
        self.f.store.with(|c| c.execute(sql, [])).expect("sql");
    }
}

pub fn str_of(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_string()
}
