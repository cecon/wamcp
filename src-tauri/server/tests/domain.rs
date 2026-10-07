//! Port of tests/domain.test.mjs: the MCP application refuses to send before reaching the port.
mod common;

use common::Fixture;
use wamcp_server::domain::error::Error;
use wamcp_server::domain::model::Credential;

fn credential(session_id: &str, scope: &str) -> Credential {
    Credential {
        id: "tok".into(),
        session_id: session_id.into(),
        scope: scope.into(),
        client_id: None,
    }
}

fn forbidden<T: std::fmt::Debug>(result: Result<T, Error>) {
    match result {
        Err(Error::Helpdesk(e)) => {
            assert_eq!(e.status, 403);
            assert_eq!(e.message, "Credencial sem permissão de envio nesta sessão");
        }
        other => panic!("expected 403, got {other:?}"),
    }
}

#[tokio::test]
async fn application_rejects_sending_with_read_only_or_cross_session_credentials_before_calling_the_port() {
    let f = Fixture::new().await;
    let a = f.session("A").id;
    let b = f.session("B").id;
    let mcp = &f.app.state.mcp;
    forbidden(
        mcp.send(&a, &credential(&a, "read"), "5511999999999@s.whatsapp.net", "text")
            .await,
    );
    forbidden(
        mcp.send(
            &b,
            &credential(&a, "read_write"),
            "5511999999999@s.whatsapp.net",
            "text",
        )
        .await,
    );
    assert!(f.wa.sent().is_empty());
    let sent = mcp
        .send(
            &a,
            &credential(&a, "read_write"),
            "5511999999999@s.whatsapp.net",
            "text",
        )
        .await;
    assert!(sent.is_ok(), "{sent:?}");
    assert_eq!(f.wa.sent().len(), 1);
}
