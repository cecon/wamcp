//! Replays the OAuth contract captured from the Node server (`golden/oauth.json`, produced by
//! `capture-oauth.mjs`) against the Rust public router and compares the responses.
mod common;
mod oauth_flow;

use common::http::Reply;
use oauth_flow::golden::{replay, Replay};
use serde_json::{json, Value};

const GOLDEN: &str = include_str!("golden/oauth.json");
const ZOD: &str = "[";

fn media_type(value: &str) -> String {
    value.split(';').next().unwrap_or_default().trim().to_string()
}

/// Shape of a redirect: target without query, plus the `error` and `state` parameters.
fn location_shape(value: &str) -> Value {
    let Ok(url) = url::Url::parse(value) else {
        return json!(value);
    };
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    json!([
        format!("{}{}", url.origin().ascii_serialization(), url.path()),
        param("error"),
        param("state")
    ])
}

/// Compares one case; returns every difference found.
fn compare(r: &Replay, expected: &Value, actual: &Reply) -> Vec<String> {
    let mut diffs = Vec::new();
    let mut check = |what: &str, want: Value, got: Value| {
        if want != got {
            diffs.push(format!("{what}: expected {want}, got {got}"));
        }
    };
    check("status", expected["status"].clone(), json!(actual.status));
    let status = expected["status"].as_u64().unwrap_or_default();
    let headers = expected["headers"].as_object().cloned().unwrap_or_default();
    for (name, want) in &headers {
        // Express answers redirects with a "Found. Redirecting" text body; only the Location matters.
        if name == "content-type" && status == 302 {
            continue;
        }
        let want = want.as_str().unwrap_or_default();
        let got = actual.header(name).map(|v| r.scrub(&v));
        match name.as_str() {
            "content-type" => check(name, json!(media_type(want)), json!(got.map(|g| media_type(&g)))),
            "location" => check(
                name,
                location_shape(want),
                got.map_or(Value::Null, |g| location_shape(&g)),
            ),
            _ => check(name, json!(want), json!(got)),
        }
    }
    let body = &expected["body"];
    match body {
        Value::Object(map) if map.contains_key("error") => {
            check("error", body["error"].clone(), actual.body["error"].clone());
            let description = body["error_description"].as_str().unwrap_or_default();
            if !description.is_empty() && !description.starts_with(ZOD) {
                check(
                    "error_description",
                    body["error_description"].clone(),
                    actual.body["error_description"].clone(),
                );
            }
        }
        Value::Object(_) => {
            let mut got: Value = serde_json::from_str(&r.scrub(&actual.body.to_string())).unwrap_or(Value::Null);
            if let (Some(issued), true) = (
                got.get("client_id_issued_at"),
                body.get("client_id_issued_at").is_some(),
            ) {
                assert!(issued.is_i64(), "client_id_issued_at must be epoch seconds: {issued}");
                got["client_id_issued_at"] = body["client_id_issued_at"].clone();
            }
            check("body", body.clone(), got);
        }
        Value::String(_) if status == 302 || status == 204 => {}
        Value::String(text) => {
            let pattern = regex::Regex::new(r#"name="request" value="[^"]+""#).expect("regex");
            let normalize = |t: &str| pattern.replace(t, r#"name="request" value="<REQUEST>""#).into_owned();
            check("body", json!(normalize(text)), json!(normalize(&r.scrub(&actual.text))));
        }
        _ => {}
    }
    diffs
}

async fn verify(names: &[&str]) {
    let golden: Vec<Value> = serde_json::from_str(GOLDEN).expect("golden json");
    let r = replay().await;
    let mut failures = Vec::new();
    for name in names {
        let expected = golden
            .iter()
            .find(|c| c["name"] == *name)
            .unwrap_or_else(|| panic!("golden case {name}"));
        let actual = &r
            .cases
            .iter()
            .find(|(n, _)| n == name)
            .unwrap_or_else(|| panic!("replayed {name}"))
            .1;
        failures.extend(
            compare(&r, expected, actual)
                .into_iter()
                .map(|d| format!("{name}: {d}")),
        );
    }
    assert!(failures.is_empty(), "contract differences:\n{}", failures.join("\n"));
}

#[tokio::test]
async fn every_golden_case_is_replayed() {
    let golden: Vec<Value> = serde_json::from_str(GOLDEN).expect("golden json");
    let r = replay().await;
    let names: Vec<&str> = r.cases.iter().map(|(n, _)| n.as_str()).collect();
    let expected: Vec<&str> = golden.iter().filter_map(|c| c["name"].as_str()).collect();
    assert_eq!(names, expected);
}

#[tokio::test]
async fn metadata_and_health_match_node() {
    let names = [
        "as_metadata",
        "pr_metadata",
        "pr_metadata_bad",
        "healthz",
        "cors_preflight_token",
        "mcp_get_unauth",
    ];
    verify(&names).await;
}

#[tokio::test]
async fn dynamic_client_registration_matches_node() {
    let names = [
        "register",
        "register_secret",
        "register_bad_redirect",
        "register_no_redirect",
        "register_bad_method",
    ];
    verify(&names).await;
    verify(&["register_bad_json"]).await;
}

#[tokio::test]
async fn authorize_and_consent_match_node() {
    verify(&[
        "authorize_ok",
        "authorize_unknown_client",
        "authorize_bad_redirect",
        "authorize_no_pkce",
        "authorize_bad_scope",
        "authorize_bad_resource",
        "authorize_plain",
        "authorize_bad_response_type",
        "authorize_post",
        "approve_bad_origin",
        "approve_bad_body",
        "approve_bad_code",
    ])
    .await;
}

#[tokio::test]
async fn token_and_revocation_match_node() {
    verify(&[
        "token_no_grant",
        "token_bad_grant",
        "token_unknown_client",
        "token_bad_code",
        "token_secret_missing",
        "token_bad_refresh",
        "token_wrong_verifier",
        "token_ok",
        "token_reuse_code",
        "token_refresh",
        "token_refresh_reuse",
        "revoke_ok",
        "revoke_missing",
    ])
    .await;
}
