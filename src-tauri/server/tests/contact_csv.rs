//! CSV import and export of contacts.
mod common;

use common::http::{multipart, send_multipart};
use common::{Fixture, Incoming};
use serde_json::json;
use wamcp_server::domain::contacts::parse_csv;

fn csv_form(csv: &str) -> Vec<u8> {
    multipart(&[], &[("import_file", "contatos.csv", "text/csv", csv.as_bytes())])
}

#[tokio::test]
async fn administrators_import_and_export_contacts() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(
        &session.id,
        Incoming {
            name: "Cliente",
            ..Default::default()
        },
    );
    let csv = "\u{feff}Name;Phone_Number;Email;Identifier\n\
               \"Silva; Ana\";+55 11 98888-0001;ana@example.com;A1\n\
               Novo nome;+5511988887777;;\n\
               Inválido;12ab;;\n\
               ;;;\n\
               ;;;sem-dados\n";
    let result = send_multipart(&admin, "/contacts/import", csv_form(csv)).await;
    assert_eq!(result.status, 200, "{}", result.text);
    assert_eq!(
        (result.body["created"].as_u64(), result.body["updated"].as_u64()),
        (Some(1), Some(1))
    );
    let lines: Vec<u64> = result.body["failed"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f["line"].as_u64())
        .collect();
    assert_eq!(lines, vec![4, 6]);
    assert_eq!(admin.get("/contacts/1").await.body["name"], "Novo nome");
    assert_eq!(
        send_multipart(&maria, "/contacts/import", csv_form(csv)).await.status,
        403
    );
    assert_eq!(
        send_multipart(&admin, "/contacts/import", csv_form("")).await.status,
        400
    );
    assert_eq!(
        send_multipart(&admin, "/contacts/import", csv_form("foo,bar\n1,2\n"))
            .await
            .status,
        400
    );
    let no_file = multipart(&[("other", "x")], &[]);
    assert_eq!(send_multipart(&admin, "/contacts/import", no_file).await.status, 400);

    admin.post("/labels", json!({ "title": "vip" })).await;
    admin.post("/contacts/2/labels", json!({ "labels": ["vip"] })).await;
    admin
        .patch("/contacts/2", json!({ "identifier": "=HYPERLINK(\"x\")" }))
        .await;
    assert_eq!(maria.get("/contacts/export").await.status, 403);
    let export = admin.get("/contacts/export").await;
    assert_eq!(export.header("content-type").unwrap(), "text/csv; charset=utf-8");
    let rows = parse_csv(&export.text);
    assert_eq!(rows[0], vec!["name", "phone_number", "email", "identifier", "labels"]);
    assert_eq!(
        rows[2],
        vec![
            "Silva; Ana",
            "+5511988880001",
            "ana@example.com",
            "'=HYPERLINK(\"x\")",
            "vip"
        ]
    );
    assert_eq!(rows.len(), 3);
}

#[test]
fn csv_parsing_handles_quotes_and_line_endings() {
    let rows = parse_csv("a,b\r\n\"x \"\"y\"\"\",\"multi\nline\"\nlast,");
    assert_eq!(
        rows,
        vec![vec!["a", "b"], vec!["x \"y\"", "multi\nline"], vec!["last", ""]]
    );
}
