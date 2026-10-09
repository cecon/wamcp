//! OAuth grants and tokens: issue, rotate (with reuse detection), revoke, authenticate and list.
use super::crypto::{random_secret, sha256_hex};
use super::oauth::{failure, Grant, OAuthResult, OAuthService};
use crate::domain::events::iso_millis;
use crate::domain::model::Credential;
use crate::domain::oauth::{oauth_require, scope_for};
use serde_json::{json, Value};

impl OAuthService {
    pub(crate) fn issue(&self, grant: &Grant) -> OAuthResult<Value> {
        let (access, refresh) = (random_secret(), random_secret());
        let ttl = (grant.expires - self.now()).min(3_600_000);
        oauth_require(ttl > 0, "Autorização expirada", "invalid_grant")?;
        self.prune()?;
        self.set(
            "access",
            &sha256_hex(&access),
            &json!({ "grantId": grant.id }),
            self.now() + ttl,
        )?;
        let record = json!({ "grantId": grant.id, "clientId": grant.client_id });
        self.set("refresh", &sha256_hex(&refresh), &record, grant.expires)?;
        Ok(json!({
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": ttl / 1000,
            "refresh_token": refresh,
            "scope": grant.scopes.join(" "),
        }))
    }

    /// The grant behind an event subscription, while it still allows reading this session.
    pub fn event_principal(&self, session_id: &str, grant_id: &str) -> Option<Credential> {
        let grant: Grant = self.get("grants", grant_id).ok()??;
        let valid = grant.session_id == session_id
            && grant.resource == self.resource_for(session_id)
            && grant.scopes.iter().any(|s| s == "whatsapp:read");
        valid.then(|| Credential {
            id: grant.id,
            session_id: session_id.into(),
            scope: scope_for(&grant.scopes).into(),
            client_id: Some(grant.client_id),
        })
    }

    /// Rotates a refresh token; reusing an old one revokes the whole grant.
    pub fn refresh(
        &self,
        client_id: &str,
        token: &str,
        scopes: Option<Vec<String>>,
        resource: Option<&str>,
    ) -> OAuthResult<Value> {
        let reused: Option<Value> = self.get("used_refresh", &sha256_hex(token))?;
        if let Some(reused) = reused {
            if reused["clientId"].as_str() == Some(client_id) && reused["resource"].as_str() == resource {
                self.remove("grants", reused["grantId"].as_str().unwrap_or_default())?;
                return Err(failure(
                    "Refresh token reutilizado; autorize novamente",
                    "invalid_grant",
                ));
            }
        }
        self.atomically(|| {
            let record: Option<Value> = self.get("refresh", &sha256_hex(token))?;
            let record = record
                .filter(|r| r["clientId"].as_str() == Some(client_id))
                .ok_or_else(|| failure("Refresh token inválido", "invalid_grant"))?;
            let grant: Option<Grant> = self.get("grants", record["grantId"].as_str().unwrap_or_default())?;
            let mut grant = grant.ok_or_else(|| failure("Autorização revogada", "invalid_grant"))?;
            oauth_require(
                Some(grant.resource.as_str()) == resource,
                "Audience inválida",
                "invalid_target",
            )?;
            if let Some(scopes) = scopes {
                let subset = scopes.iter().all(|s| grant.scopes.contains(s));
                oauth_require(subset, "Escopo não autorizado", "invalid_scope")?;
                oauth_require(
                    scopes.iter().any(|s| s == "whatsapp:read"),
                    "Leitura necessária",
                    "invalid_scope",
                )?;
                grant.scopes = scopes;
                self.set("grants", &grant.id, &grant, grant.expires)?;
            }
            self.remove("refresh", &sha256_hex(token))?;
            let mut used = record.clone();
            used["resource"] = json!(grant.resource);
            self.set("used_refresh", &sha256_hex(token), &used, grant.expires)?;
            self.issue(&grant)
        })
    }

    /// Revokes the grant behind an access or refresh token, when it belongs to the client.
    pub fn revoke(&self, client_id: &str, token: &str) -> OAuthResult<()> {
        let hash = sha256_hex(token);
        let access: Option<Value> = match self.get("access", &hash)? {
            Some(found) => Some(found),
            None => self.get("refresh", &hash)?,
        };
        let Some(grant_id) = access.as_ref().and_then(|a| a["grantId"].as_str()) else {
            return Ok(());
        };
        let grant: Option<Grant> = self.get("grants", grant_id)?;
        if let Some(grant) = grant.filter(|g| g.client_id == client_id) {
            self.remove("grants", &grant.id)?;
        }
        Ok(())
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
