//! Governance: human approval of sensitive calls, isolation between two organizations and memory
//! scopes (private, organization), corrections and erasure.
mod engine_support;

use engine_support::{ai_agent, engine, seed, standard, Outcome, RecordingChannel, ScriptedRuntime, Turn};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineService, Submission};
use wamcp_server::application::ports::EngineRepo;

fn ask(account: i64, agent: i64, request: &str) -> Submission {
    Submission {
        account_id: account,
        agent_id: agent,
        request: request.into(),
        requester: "user:1".into(),
        conversation_id: Some(5),
        ..Submission::default()
    }
}

async fn until_final(engine: &EngineService, account: i64, id: i64) -> String {
    for _ in 0..200 {
        let detail = engine.detail(account, id).unwrap();
        let status = detail["activity"]["status"].as_str().unwrap().to_string();
        if ["completed", "failed", "cancelled"].contains(&status.as_str()) {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("activity {id} never finished");
}

#[tokio::test]
async fn a_call_that_needs_approval_waits_and_resumes_once_approved() {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    store
        .set_grant(1, org.anny, "financeiro.consultar_pagamento", Some("approval"))
        .unwrap();
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    standard(&runtime, &org);
    let engine = engine(store.clone(), runtime.clone(), channel.clone());

    let (root, _) = engine.submit(&ask(1, org.lu, "O cliente ACME pagou?")).unwrap();
    let waiting = engine.execute(1, root.id).await.unwrap();
    assert_eq!(waiting.status, "waiting_approval");
    let detail = engine.detail(1, root.id).unwrap();
    let call = &detail["tree"][1]["tool_calls"][0];
    assert_eq!(call["status"], "pending_approval");
    assert!(channel.replies.lock().is_empty());

    // A second decision on the same call is refused; the first one runs the tool and resumes both.
    let decided = engine.decide(1, call["id"].as_i64().unwrap(), true, 1).await.unwrap();
    assert_eq!(decided.status, "ok");
    assert!(engine.decide(1, decided.id, false, 1).await.is_err());
    assert_eq!(until_final(&engine, 1, root.id).await, "completed");
    let replies = channel.replies.lock().clone();
    assert_eq!(replies.len(), 1);
    assert!(replies[0].1.contains("pago"));
    // The tool ran once, at approval time; the resumed run got the stored result.
    let calls = store
        .tool_calls(1, detail["tree"][1]["activity"]["id"].as_i64().unwrap())
        .unwrap();
    assert_eq!(calls.len(), 1);
    let audit = engine.detail(1, root.id).unwrap()["audit"].to_string();
    assert!(audit.contains("approval_required") && audit.contains("approved"));
}

#[tokio::test]
async fn organizations_never_see_each_others_agents_activities_or_memory() {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    // Organization 1 has only Lu; organization 2 has its own Lu and Anny.
    let lu1 = ai_agent(&store, 1, "Lu1", "coordinator", &["recepcao"]);
    let org2 = seed(&store, 2);
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    runtime.script("Lu1", engine_support::lu_script());
    standard(&runtime, &org2);
    let engine = engine(store.clone(), runtime.clone(), channel);

    let (root, _) = engine.submit(&ask(1, lu1, "O cliente ACME pagou?")).unwrap();
    let done = engine.execute(1, root.id).await.unwrap();
    assert!(
        done.result.unwrap().contains("Nenhum outro agente"),
        "Anny of org 2 must be invisible"
    );
    assert_eq!(runtime.runs_of("Anny2"), 0);

    // Another organization cannot read the activity nor start work for org 1's agent.
    assert!(engine.detail(2, root.id).is_err());
    assert!(engine.submit(&ask(2, lu1, "Oi")).is_err());
    assert!(engine.policy(2, lu1).is_err());

    // Memory: organization scope is shared inside the organization only; private stays private.
    runtime.script(
        "Anny2",
        Arc::new(|turn: Turn| {
            Box::pin(async move {
                turn.call(
                    "memoria.lembrar",
                    json!({"conteudo": "ACME paga sempre no dia 20", "tipo": "semantic", "escopo": "organization"}),
                )
                .await;
                turn.call("memoria.lembrar", json!({"conteudo": "Prefiro respostas curtas"}))
                    .await;
                turn.call("concluir", json!({"resposta": "Anotado"})).await;
                Outcome::Done
            })
        }),
    );
    let (note, _) = engine.submit(&ask(2, org2.anny, "Anote")).unwrap();
    engine.execute(2, note.id).await.unwrap();
    let lu2 = engine.agent_memories(2, org2.lu).unwrap();
    assert_eq!(lu2.len(), 1);
    assert_eq!(lu2[0].content, "ACME paga sempre no dia 20");
    assert_eq!(engine.agent_memories(2, org2.anny).unwrap().len(), 2);
    assert!(engine.agent_memories(1, lu1).unwrap().is_empty());
    assert!(engine.agent_memories(1, org2.anny).is_err());

    // Corrected: a new version supersedes the old one. Erased: gone for everyone.
    let fixed = engine.correct_memory(2, lu2[0].id, "ACME paga no dia 25").unwrap();
    assert_eq!((fixed.version, fixed.supersedes), (2, Some(lu2[0].id)));
    let seen: Vec<String> = engine
        .agent_memories(2, org2.lu)
        .unwrap()
        .into_iter()
        .map(|m| m.content)
        .collect();
    assert_eq!(seen, vec!["ACME paga no dia 25".to_string()]);
    assert!(engine.correct_memory(1, fixed.id, "outra empresa").is_err());
    engine.forget_memory(2, fixed.id).unwrap();
    assert!(engine.agent_memories(2, org2.lu).unwrap().is_empty());
}
