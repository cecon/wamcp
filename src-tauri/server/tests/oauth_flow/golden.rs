//! Replays the OAuth traffic captured from the Node server (`golden/oauth.json`) on a fresh flow.
use super::{encode, pairs, str_of, with, Flow, Form, CALLBACK};
use crate::common::http::{request, Reply};
use crate::common::ORIGIN;
use serde_json::{json, Value};

/// The Rust responses by golden case name, plus the random ids to replace by placeholders.
pub struct Replay {
    pub cases: Vec<(String, Reply)>,
    pub ids: Vec<(String, String)>,
}

impl Replay {
    pub fn push(&mut self, name: &str, reply: Reply) -> Value {
        let body = reply.body.clone();
        self.cases.push((name.into(), reply));
        body
    }

    pub fn id(&mut self, value: &str, placeholder: &str) {
        if !value.is_empty() {
            self.ids.push((value.into(), placeholder.into()));
        }
    }

    pub fn scrub(&self, text: &str) -> String {
        self.ids
            .iter()
            .fold(text.to_string(), |out, (value, name)| out.replace(value, name))
    }
}

pub async fn replay() -> Replay {
    let flow = Flow::new().await;
    let f = &flow;
    let mut r = Replay {
        cases: Vec::new(),
        ids: Vec::new(),
    };
    r.id(&f.a.id, "<SESSION_A>");
    r.id(&f.b.id, "<SESSION_B>");
    r.push(
        "as_metadata",
        f.get("/.well-known/oauth-authorization-server", &[]).await,
    );
    r.push(
        "pr_metadata",
        f.get(&format!("/.well-known/oauth-protected-resource/mcp/{}", f.a.id), &[])
            .await,
    );
    r.push(
        "pr_metadata_bad",
        f.get("/.well-known/oauth-protected-resource/mcp/not-a-uuid", &[]).await,
    );
    let client = r.push("register", f.register(json!({})).await);
    let client = str_of(&client, "client_id");
    r.id(&client, "<CLIENT>");
    let register = |body: Value| f.f.public(request("POST", "/register", Some(body), &[]));
    let secret = register(json!({ "client_name": "Secret", "redirect_uris": [CALLBACK] })).await;
    let secret = r.push("register_secret", secret);
    let (secret_client, client_secret) = (str_of(&secret, "client_id"), str_of(&secret, "client_secret"));
    r.id(&secret_client, "<SECRET_CLIENT>");
    r.id(&client_secret, "<CLIENT_SECRET>");
    r.push(
        "register_bad_redirect",
        register(json!({ "redirect_uris": ["https://evil.example/cb"] })).await,
    );
    r.push("register_no_redirect", register(json!({ "client_name": "x" })).await);
    let bad_method = json!({ "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "private_key_jwt" });
    r.push("register_bad_method", register(bad_method).await);
    let raw = axum::http::Request::builder()
        .method("POST")
        .uri("/register")
        .header("content-type", "application/json")
        .body(axum::body::Body::from("{"))
        .expect("request");
    r.push("register_bad_json", f.f.public(raw).await);

    let base = pairs(&[
        ("client_id", &client),
        ("redirect_uri", CALLBACK),
        ("response_type", "code"),
        ("code_challenge_method", "S256"),
        ("code_challenge", &"a".repeat(43)),
        ("scope", "whatsapp:read whatsapp:send"),
        ("state", "st"),
        ("resource", &f.resource),
    ]);
    let authorize = |params: Form| async move { f.get(&format!("/authorize?{}", encode(&params)), &[]).await };
    let consent = authorize(base.clone()).await;
    let request_id = consent
        .text
        .split("name=\"request\" value=\"")
        .nth(1)
        .and_then(|s| s.split('"').next());
    let request_id = request_id.unwrap_or_default().to_string();
    r.id(&request_id, "<REQUEST>");
    r.push("authorize_ok", consent);
    r.push(
        "authorize_unknown_client",
        authorize(with(&base, &[("client_id", "nope")])).await,
    );
    let other_redirect = with(&base, &[("redirect_uri", "https://chatgpt.com/connector/oauth/other")]);
    r.push("authorize_bad_redirect", authorize(other_redirect).await);
    let no_pkce: Form = base
        .iter()
        .filter(|(k, _)| !k.starts_with("code_challenge"))
        .cloned()
        .collect();
    r.push("authorize_no_pkce", authorize(no_pkce).await);
    r.push(
        "authorize_bad_scope",
        authorize(with(&base, &[("scope", "admin")])).await,
    );
    let bad_resource = with(&base, &[("resource", "https://evil.example/mcp/x")]);
    r.push("authorize_bad_resource", authorize(bad_resource).await);
    r.push(
        "authorize_plain",
        authorize(with(&base, &[("code_challenge_method", "plain")])).await,
    );
    r.push(
        "authorize_bad_response_type",
        authorize(with(&base, &[("response_type", "token")])).await,
    );
    r.push("authorize_post", f.form("/authorize", &base, &[]).await);

    let approve = |form: Form, origin: &'static str| async move { f.approve_form(&form, origin).await };
    let bad_origin = pairs(&[("request", &request_id), ("code", "y")]);
    r.push("approve_bad_origin", approve(bad_origin, "https://evil.example").await);
    r.push(
        "approve_bad_body",
        approve(pairs(&[("request", "short"), ("code", "y")]), ORIGIN).await,
    );
    let bad_code = pairs(&[("request", &request_id), ("code", &"z".repeat(43))]);
    r.push("approve_bad_code", approve(bad_code, ORIGIN).await);

    let (y43, cid) = ("y".repeat(43), client.as_str());
    let token = |items: Form| async move { f.token(&items).await };
    r.push("token_no_grant", token(pairs(&[("client_id", cid)])).await);
    r.push(
        "token_bad_grant",
        token(pairs(&[("client_id", cid), ("grant_type", "password")])).await,
    );
    let unknown = pairs(&[
        ("client_id", "nope"),
        ("grant_type", "authorization_code"),
        ("code", "x"),
        ("code_verifier", "y"),
    ]);
    r.push("token_unknown_client", token(unknown).await);
    let bad_code = pairs(&[
        ("client_id", cid),
        ("grant_type", "authorization_code"),
        ("code", "x"),
        ("code_verifier", &y43),
        ("redirect_uri", CALLBACK),
        ("resource", &f.resource),
    ]);
    r.push("token_bad_code", token(bad_code).await);
    let secret_missing = pairs(&[
        ("client_id", &secret_client),
        ("grant_type", "authorization_code"),
        ("code", "x"),
        ("code_verifier", &y43),
    ]);
    r.push("token_secret_missing", token(secret_missing).await);
    let refresh = |t: &str| {
        pairs(&[
            ("client_id", cid),
            ("grant_type", "refresh_token"),
            ("refresh_token", t),
            ("resource", &f.resource),
        ])
    };
    r.push("token_bad_refresh", token(refresh("x")).await);

    let body = f.approve(&client, "read_write").await;
    r.id(&body[0].1, "<CODE>");
    r.push(
        "token_wrong_verifier",
        token(with(&body, &[("code_verifier", &"w".repeat(43))])).await,
    );
    let tokens = r.push("token_ok", token(body.clone()).await);
    r.id(&str_of(&tokens, "access_token"), "<ACCESS_TOKEN>");
    r.id(&str_of(&tokens, "refresh_token"), "<REFRESH_TOKEN>");
    r.push("token_reuse_code", token(body).await);
    let next = r.push("token_refresh", token(refresh(&str_of(&tokens, "refresh_token"))).await);
    r.id(&str_of(&next, "access_token"), "<NEXT_ACCESS_TOKEN>");
    r.id(&str_of(&next, "refresh_token"), "<NEXT_REFRESH_TOKEN>");
    r.push(
        "token_refresh_reuse",
        token(refresh(&str_of(&tokens, "refresh_token"))).await,
    );
    let revoke = pairs(&[("client_id", cid), ("token", &str_of(&next, "access_token"))]);
    r.push("revoke_ok", f.form("/revoke", &revoke, &[]).await);
    r.push(
        "revoke_missing",
        f.form("/revoke", &pairs(&[("client_id", cid)]), &[]).await,
    );
    r.push(
        "mcp_get_unauth",
        f.f.public(request("GET", &format!("/mcp/{}", f.a.id), None, &[])).await,
    );
    r.push("healthz", f.get("/healthz", &[]).await);
    let preflight = [
        ("origin", "https://chatgpt.com"),
        ("access-control-request-method", "POST"),
    ];
    r.push(
        "cors_preflight_token",
        f.f.public(request("OPTIONS", "/token", None, &preflight)).await,
    );
    r
}
