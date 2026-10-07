//! OAuth authorization server for MCP clients: dynamic registration, consent linked to a code
//! generated in the desktop app, PKCE authorization codes and session-bound grants.
use super::crypto::{random_secret, sha256_hex};
use super::ports::{transaction, Clock, Repository};
use crate::domain::events::iso_millis;
use crate::domain::model::Credential;
use crate::domain::oauth::{oauth_require, scope_for, scopes_for, valid_oauth_redirect, OAuthFailure, OAUTH_SCOPES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub const TEN_MINUTES: i64 = 600_000;
const NEVER: i64 = 9_007_199_254_740_991;
pub type OAuthResult<T> = std::result::Result<T, OAuthFailure>;

/// A pending authorization (consent page) or an issued code.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub client_id: String,
    pub client_name: String,
    pub session_id: String,
    pub resource: String,
    pub scopes: Vec<String>,
    pub redirect_uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub challenge: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub session_id: String,
    pub resource: String,
    pub scopes: Vec<String>,
    pub created: String,
    pub expires: i64,
}

/// Parameters of an authorization request, already validated by the HTTP adapter.
pub struct AuthorizeParams {
    pub resource: Option<String>,
    pub scopes: Vec<String>,
    pub code_challenge: String,
    pub redirect_uri: String,
    pub state: Option<String>,
}

#[derive(Clone)]
pub struct OAuthService {
    pub repo: Arc<dyn Repository>,
    pub clock: Arc<dyn Clock>,
    pub public_url: String,
}

fn internal(_: crate::domain::error::Error) -> OAuthFailure {
    OAuthFailure { code: "server_error".into(), message: "Internal Server Error".into() }
}

impl OAuthService {
    pub fn now(&self) -> i64 {
        self.clock.now_ms()
    }

    pub fn resource_for(&self, session_id: &str) -> String {
        format!("{}/mcp/{session_id}", self.public_url)
    }

    pub(crate) fn get<T: serde::de::DeserializeOwned>(&self, bucket: &str, key: &str) -> OAuthResult<Option<T>> {
        let value = self.repo.get(bucket, key, self.now()).map_err(internal)?;
        Ok(value.and_then(|v| serde_json::from_value(v).ok()))
    }

    pub(crate) fn set(&self, bucket: &str, key: &str, value: &impl Serialize, expires: i64) -> OAuthResult<()> {
        let value = serde_json::to_value(value).map_err(|e| internal(e.into()))?;
        self.repo.set(bucket, key, &value, expires).map_err(internal)
    }

    pub(crate) fn remove(&self, bucket: &str, key: &str) -> OAuthResult<()> {
        self.repo.remove(bucket, key).map_err(internal)
    }

    pub(crate) fn prune(&self) -> OAuthResult<()> {
        self.repo.prune(self.now()).map_err(internal)
    }

    pub(crate) fn atomically<T>(&self, work: impl FnOnce() -> OAuthResult<T>) -> OAuthResult<T> {
        let mut failure = None;
        let result = transaction(&*self.repo, || {
            work().map_err(|e| {
                failure = Some(e);
                crate::domain::error::Error::internal("oauth failure")
            })
        });
        match (result, failure) {
            (Ok(value), _) => Ok(value),
            (Err(_), Some(failure)) => Err(failure),
            (Err(e), None) => Err(internal(e)),
        }
    }

    fn session_for(&self, resource: Option<&str>) -> OAuthResult<String> {
        let prefix = format!("{}/mcp/", self.public_url);
        let id = resource.and_then(|r| r.strip_prefix(&prefix));
        oauth_require(id.is_some(), "Recurso inválido", "invalid_target")?;
        let id = id.unwrap_or_default().to_string();
        let exists = self.repo.session(&id).map_err(internal)?.is_some();
        oauth_require(exists, "Sessão não encontrada", "invalid_target")?;
        Ok(id)
    }

    pub fn get_client(&self, id: &str) -> Option<Value> {
        self.get("clients", id).ok().flatten()
    }

    /// Stores a dynamically registered client (the adapter assigns ids and secrets).
    pub fn register_client(&self, mut client: Value) -> OAuthResult<Value> {
        let redirects: Vec<&str> = client["redirect_uris"]
            .as_array()
            .map(|uris| uris.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let count = client["redirect_uris"].as_array().map_or(0, Vec::len);
        let valid = (1..=5).contains(&count) && redirects.len() == count && redirects.iter().all(|r| valid_oauth_redirect(r));
        oauth_require(valid, "Callback deve ser do ChatGPT ou o retorno local do aplicativo desktop", "invalid_client_metadata")?;
        let method = client["token_endpoint_auth_method"].as_str();
        let supported = matches!(method, None | Some("none") | Some("client_secret_post"));
        oauth_require(supported, "Método de autenticação não suportado", "invalid_client_metadata")?;
        let name_ok = client["client_name"].as_str().is_none_or(|n| n.chars().count() <= 120);
        oauth_require(name_ok, "Nome de cliente inválido", "invalid_client_metadata")?;
        if method.is_none() {
            client["token_endpoint_auth_method"] = json!("client_secret_post");
        }
        let id = client["client_id"].as_str().unwrap_or_default().to_string();
        self.set("clients", &id, &client, NEVER)?;
        Ok(client)
    }

    /// A one-time code the desktop owner gives to the consent page, valid for ten minutes.
    pub fn create_link(&self, session_id: &str, scope: &str) -> OAuthResult<Value> {
        let exists = self.repo.session(session_id).map_err(internal)?.is_some();
        oauth_require(exists, "Sessão não encontrada", "invalid_grant")?;
        self.prune()?;
        let (code, expires) = (random_secret(), self.now() + TEN_MINUTES);
        self.set("links", &sha256_hex(&code), &json!({ "sessionId": session_id, "scope": scope }), expires)?;
        Ok(json!({ "code": code, "expires": iso_millis(expires), "resource": self.resource_for(session_id) }))
    }

    /// Starts an authorization: returns the opaque request id and what the consent page shows.
    pub fn begin(&self, client: &Value, params: AuthorizeParams) -> OAuthResult<(String, Pending)> {
        let session_id = self.session_for(params.resource.as_deref())?;
        let scopes = if params.scopes.is_empty() { vec!["whatsapp:read".to_string()] } else { params.scopes };
        let known = scopes.iter().all(|s| OAUTH_SCOPES.contains(&s.as_str()));
        oauth_require(known, "Escopo inválido", "invalid_scope")?;
        let pkce = params.code_challenge.len() == 43
            && params.code_challenge.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        oauth_require(pkce, "PKCE S256 obrigatório", "invalid_request")?;
        let request = random_secret();
        self.prune()?;
        let pending = Pending {
            client_id: client["client_id"].as_str().unwrap_or_default().into(),
            client_name: client["client_name"].as_str().filter(|n| !n.is_empty()).unwrap_or("Cliente ChatGPT").into(),
            session_id,
            resource: params.resource.unwrap_or_default(),
            scopes,
            redirect_uri: params.redirect_uri,
            state: params.state,
            challenge: params.code_challenge,
        };
        self.set("pending", &sha256_hex(&request), &pending, self.now() + TEN_MINUTES)?;
        Ok((request, pending))
    }

    /// Consent approved with the desktop code: issues an authorization code and the redirect URL.
    pub fn approve(&self, request: &str, link_code: &str) -> OAuthResult<String> {
        self.atomically(|| {
            let pending: Option<Pending> = self.get("pending", &sha256_hex(request))?;
            let link: Option<Value> = self.get("links", &sha256_hex(link_code))?;
            let (pending, link) = match (pending, link) {
                (Some(p), Some(l)) if l["sessionId"].as_str() == Some(p.session_id.as_str()) => (p, l),
                _ => return Err(failure("Código inválido, expirado ou de outra sessão", "invalid_grant")),
            };
            let allowed = scopes_for(link["scope"].as_str().unwrap_or_default());
            let scopes: Vec<String> = pending.scopes.iter().filter(|s| allowed.contains(s)).cloned().collect();
            oauth_require(scopes.iter().any(|s| s == "whatsapp:read"), "Permissão de leitura necessária", "invalid_scope")?;
            let code = random_secret();
            let issued = Pending { scopes, ..pending.clone() };
            self.set("codes", &sha256_hex(&code), &issued, self.now() + 60_000)?;
            self.remove("pending", &sha256_hex(request))?;
            self.remove("links", &sha256_hex(link_code))?;
            let mut redirect = url::Url::parse(&pending.redirect_uri)
                .map_err(|_| failure("Callback inválido", "invalid_request"))?;
            redirect.query_pairs_mut().append_pair("code", &code);
            if let Some(state) = &pending.state {
                redirect.query_pairs_mut().append_pair("state", state);
            }
            Ok(redirect.to_string())
        })
    }

    pub fn challenge(&self, client_id: &str, code: &str) -> OAuthResult<String> {
        let data: Option<Pending> = self.get("codes", &sha256_hex(code))?;
        match data.filter(|d| d.client_id == client_id) {
            Some(d) => Ok(d.challenge),
            None => Err(failure("Código inválido", "invalid_grant")),
        }
    }

    pub fn exchange(&self, client: &Value, code: &str, redirect_uri: Option<&str>, resource: Option<&str>) -> OAuthResult<Value> {
        let client_id = client["client_id"].as_str().unwrap_or_default();
        self.atomically(|| {
            let data: Option<Pending> = self.get("codes", &sha256_hex(code))?;
            let data = data
                .filter(|d| d.client_id == client_id && redirect_uri == Some(d.redirect_uri.as_str()))
                .ok_or_else(|| failure("Código ou callback inválido", "invalid_grant"))?;
            oauth_require(Some(data.resource.as_str()) == resource, "Audience inválida", "invalid_target")?;
            self.remove("codes", &sha256_hex(code))?;
            let now = self.now();
            let grant = Grant {
                id: random_secret(),
                client_id: client_id.into(),
                client_name: data.client_name,
                session_id: data.session_id,
                resource: data.resource,
                scopes: data.scopes,
                created: iso_millis(now),
                expires: now + 90 * 86_400_000,
            };
            self.set("grants", &grant.id, &grant, grant.expires)?;
            self.issue(&grant)
        })
    }

    pub fn connections(&self, session_id: &str) -> Vec<Value> {
        let grants = self.repo.list("grants", self.now()).unwrap_or_default();
        grants
            .into_iter()
            .filter_map(|g| serde_json::from_value::<Grant>(g).ok())
            .filter(|g| g.session_id == session_id)
            .map(|g| json!({ "id": g.id, "name": g.client_name, "scope": scope_for(&g.scopes), "created": g.created, "expires": iso_millis(g.expires) }))
            .collect()
    }

    pub fn disconnect(&self, session_id: &str, grant_id: &str) -> OAuthResult<()> {
        let grant: Option<Grant> = self.get("grants", grant_id)?;
        if grant.is_some_and(|g| g.session_id == session_id) {
            self.remove("grants", grant_id)?;
        }
        Ok(())
    }

    /// Resolves an access token into a credential bound to this session's MCP resource.
    pub fn authenticate(&self, session_id: &str, token: &str) -> Option<Credential> {
        if token.len() > 256 {
            return None;
        }
        let access: Value = self.get("access", &sha256_hex(token)).ok()??;
        let grant: Grant = self.get("grants", access["grantId"].as_str()?).ok()??;
        if grant.session_id != session_id || grant.resource != self.resource_for(session_id) {
            return None;
        }
        Some(Credential {
            id: grant.id,
            session_id: session_id.into(),
            scope: scope_for(&grant.scopes).into(),
            client_id: Some(grant.client_id),
        })
    }
}

pub fn failure(message: &str, code: &str) -> OAuthFailure {
    OAuthFailure { code: code.into(), message: message.into() }
}
