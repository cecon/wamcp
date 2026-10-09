//! Media in the chat: uploads sent through WhatsApp, incoming media stored under
//! `media/<session>/<YYYY>/<MM>/`, authenticated downloads and voice notes.
mod common;

use common::http::{multipart, send_multipart};
use common::{Agent, Fixture, Incoming};
use serde_json::{json, Value};
use wamcp_server::application::ports::{MediaStorage, MirrorRepo};
use wamcp_server::domain::model::{MediaMetadata, WaMessage};

async fn upload(agent: &Agent, display: i64, body: Vec<u8>) -> common::http::Reply {
    send_multipart(agent, &format!("/conversations/{display}/messages"), body).await
}

async fn get_file(agent: &Agent, url: &str) -> common::http::Reply {
    let request = common::http::request("GET", url, None, &[("cookie", &agent.cookie)]);
    common::http::send(&agent.router, request).await
}

#[tokio::test]
async fn agents_send_files_with_caption_and_voice_notes() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(&session.id, Incoming::default());
    let body = multipart(
        &[("content", "Segue o boleto")],
        &[("attachments[]", "boleto.pdf", "application/pdf", b"%PDF-1")],
    );
    let reply = upload(&admin, 1, body).await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    assert_eq!(reply.body["status"], "sent");
    assert_eq!(reply.body["content"], "Segue o boleto");
    let attachment = &reply.body["attachments"][0];
    assert_eq!(
        (attachment["file_type"].as_str(), attachment["file_name"].as_str()),
        (Some("file"), Some("boleto.pdf"))
    );
    assert_eq!(attachment["downloaded"], true);
    let request = f.wa.requests.lock().last().cloned().unwrap();
    let media = request.media.unwrap();
    assert_eq!(
        (media.file_type.as_str(), media.caption.as_deref()),
        ("file", Some("*Admin*:\nSegue o boleto"))
    );
    assert_eq!(media.bytes, b"%PDF-1");
    let source = reply.body["source_id"].as_str().unwrap();
    let path = format!("media/{}/2027/01/{source}.pdf", session.id);
    assert_eq!(
        f.storage.read(&path).unwrap().as_deref(),
        Some(&b"%PDF-1"[..]),
        "organised by session/year/month"
    );
    let file = get_file(&admin, attachment["data_url"].as_str().unwrap()).await;
    assert_eq!((file.status, file.text.as_str()), (200, "%PDF-1"));
    assert_eq!(file.header("content-type").as_deref(), Some("application/pdf"));
    assert!(file.header("content-disposition").unwrap().contains("boleto.pdf"));

    let voice = multipart(
        &[("voice", "true")],
        &[("attachments[]", "nota.ogg", "audio/ogg", b"OggS")],
    );
    let note = upload(&admin, 1, voice).await;
    assert_eq!(note.body["attachments"][0]["voice"], true);
    assert_eq!(note.body["content"], Value::Null);
    let sent = f.wa.requests.lock().last().cloned().unwrap().media.unwrap();
    assert!(sent.voice && sent.file_type == "audio");
}

#[tokio::test]
async fn uploads_are_validated_and_private_files_stay_local() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(&session.id, Incoming::default());
    let empty = upload(
        &admin,
        1,
        multipart(&[], &[("attachments[]", "x.png", "image/png", b"")]),
    )
    .await;
    assert_eq!(
        (empty.status, empty.body["error"].as_str()),
        (400, Some("O arquivo está vazio"))
    );
    assert_eq!(
        upload(&admin, 1, multipart(&[("content", "  ")], &[])).await.status,
        400
    );
    let before = f.wa.requests.lock().len();
    let note = multipart(
        &[("private", "true")],
        &[("attachments[]", "print.png", "image/png", b"PNG")],
    );
    let stored = upload(&admin, 1, note).await;
    assert_eq!(
        (
            stored.body["private"].as_bool(),
            stored.body["attachments"][0]["file_type"].as_str()
        ),
        (Some(true), Some("image"))
    );
    assert_eq!(f.wa.requests.lock().len(), before, "private notes never reach WhatsApp");
    let two = multipart(
        &[("content", "fotos")],
        &[
            ("attachments[]", "a.jpg", "image/jpeg", b"A"),
            ("attachments[]", "b.jpg", "image/jpeg", b"B"),
        ],
    );
    assert_eq!(upload(&admin, 1, two).await.status, 201);
    let captions: Vec<Option<String>> =
        f.wa.requests
            .lock()
            .iter()
            .rev()
            .take(2)
            .map(|r| r.media.clone().unwrap().caption)
            .collect();
    assert_eq!(
        captions,
        vec![None, Some("*Admin*:\nfotos".to_string())],
        "one WhatsApp message per file, caption on the first"
    );
    f.wa.fail_with(Some("Sessão desconectada"));
    let failed = upload(
        &admin,
        1,
        multipart(&[], &[("attachments[]", "c.jpg", "image/jpeg", b"C")]),
    )
    .await;
    assert_eq!(failed.body["status"], "failed");
}

#[tokio::test]
async fn incoming_media_is_downloaded_in_the_background_and_served_to_members_only() {
    let f = Fixture::new().await;
    let (session, other) = (f.session("Suporte"), f.session("Outra"));
    let admin = f.bootstrap().await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    *f.wa.media.lock() = Some(b"JPEGDATA".to_vec());
    let message = WaMessage {
        id: "IMG1".into(),
        jid: "5511988887777@s.whatsapp.net".into(),
        alt_jid: None,
        from_me: false,
        sender: "Cliente".into(),
        push_name: Some("Cliente".into()),
        body: "[image]".into(),
        kind: "imageMessage".into(),
        ts: f.now(),
    };
    let meta = MediaMetadata {
        kind: "image".into(),
        mime_type: "image/jpeg".into(),
        file_name: None,
        size: Some(8),
        duration: None,
        voice: false,
    };
    f.store
        .store_message(&session.id, &message, Some((&meta, b"payload")))
        .unwrap();
    let stored = f
        .app
        .state
        .support()
        .helpdesk
        .ingest(&session.id, &message)
        .unwrap()
        .unwrap();
    assert_eq!(stored.content, None, "the [image] placeholder is not shown as text");
    assert_eq!(stored.content_type, "image");
    f.settle().await;
    let path = format!("media/{}/2027/01/IMG1.jpg", session.id);
    assert_eq!(f.storage.read(&path).unwrap().as_deref(), Some(&b"JPEGDATA"[..]));
    let messages = admin.get("/conversations/1/messages").await.body;
    let attachment = messages[0]["attachments"][0].clone();
    assert_eq!(
        (attachment["downloaded"].as_bool(), attachment["mime_type"].as_str()),
        (Some(true), Some("image/jpeg"))
    );
    let url = attachment["data_url"].as_str().unwrap();
    assert_eq!(get_file(&admin, url).await.text, "JPEGDATA");
    assert_eq!(get_file(&outsider, url).await.status, 404);
    assert_eq!(get_file(&admin, "/api/v1/attachments/999").await.status, 404);
    assert_eq!(f.public(common::http::request("GET", url, None, &[])).await.status, 401);
    let _ = other;
}

#[tokio::test]
async fn attachments_are_fetched_on_demand_when_the_background_download_failed() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let message = WaMessage {
        id: "DOC1".into(),
        jid: "5511988887777@s.whatsapp.net".into(),
        alt_jid: None,
        from_me: false,
        sender: "Cliente".into(),
        push_name: Some("Cliente".into()),
        body: "contrato.pdf".into(),
        kind: "documentMessage".into(),
        ts: f.now(),
    };
    let meta = MediaMetadata {
        kind: "document".into(),
        mime_type: "application/pdf".into(),
        file_name: Some("contrato.pdf".into()),
        size: Some(3),
        duration: None,
        voice: false,
    };
    f.store
        .store_message(&session.id, &message, Some((&meta, b"payload")))
        .unwrap();
    f.app.state.support().helpdesk.ingest(&session.id, &message).unwrap();
    f.settle().await;
    let messages = admin.get("/conversations/1/messages").await.body;
    let attachment = messages[0]["attachments"][0].clone();
    assert_eq!(
        (attachment["downloaded"].as_bool(), attachment["file_type"].as_str()),
        (Some(false), Some("file"))
    );
    assert_eq!(
        messages[0]["content"],
        Value::Null,
        "a document's own name is not repeated as text"
    );
    let url = attachment["data_url"].as_str().unwrap();
    let offline = get_file(&admin, url).await;
    assert_eq!(
        (offline.status, offline.body["error"].as_str()),
        (400, Some("Conecte a sessão ao WhatsApp para baixar o anexo."))
    );
    *f.wa.media.lock() = Some(b"PDF".to_vec());
    assert_eq!(get_file(&admin, url).await.text, "PDF");
    assert_eq!(
        admin.get("/conversations/1/messages").await.body[0]["attachments"][0]["downloaded"],
        json!(true)
    );
}
