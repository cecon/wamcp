//! Engine failure paths: unavailable tool, denied permission, coordinators that try to execute,
//! invented evidence, provider failures and runs that end without concluding (bounded retries, a
//! fixed notice, never an invented answer), timeouts, circular delegation and budgets.
mod engine_support;

use engine_support::{
    anny_script, engine, lu_script, seed, standard, Org, Outcome, RecordingChannel, ScriptedRuntime, Turn,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineService, Submission};
use wamcp_server::application::ports::EngineRepo;
use wamcp_server::domain::engine::model::Activity;
use wamcp_server::domain::engine::FAILURE_NOTICE;

struct Case {
    store: Arc<SqliteStore>,
    org: Org,
    runtime: Arc<ScriptedRuntime>,
    channel: Arc<RecordingChannel>,
    engine: EngineService,
}

fn case() -> Case {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    standard(&runtime, &org);
    let engine = engine(store.clone(), runtime.clone(), channel.clone());
    Case {
        store,
        org,
        runtime,
        channel,
        engine,
    }
}

impl Case {
    async fn ask(&self, agent: i64, request: &str) -> Activity {
        let submission = Submission {
            account_id: self.org.account,
            agent_id: agent,
            request: request.into(),
            requester: "user:1".into(),
            conversation_id: Some(9),
            ..Submission::default()
        };
        let (activity, _) = self.engine.submit(&submission).unwrap();
        self.engine.execute(self.org.account, activity.id).await.unwrap()
    }

    fn audit(&self, root: i64) -> Vec<String> {
        let detail = self.engine.detail(self.org.account, root).unwrap();
        detail["audit"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| format!("{}:{}", a["action"].as_str().unwrap(), a["outcome"].as_str().unwrap()))
            .collect()
    }

    fn child(&self, root: i64) -> Value {
        self.engine.detail(self.org.account, root).unwrap()["tree"][1].clone()
    }
}

#[tokio::test]
async fn an_unavailable_tool_is_reported_not_invented() {
    let c = case();
    let done = c.ask(c.org.lu, "O cliente Indisponivel pagou?").await;
    assert_eq!(done.status, "completed");
    assert!(done.result.unwrap().contains("Não consegui consultar"));
    assert!(done.evidence.is_empty());
    assert_eq!(c.child(done.id)["tool_calls"][0]["status"], "failed");
    assert!(c.audit(done.id).contains(&"tool.call:failed".to_string()));
}

#[tokio::test]
async fn tools_are_denied_without_a_grant_and_to_coordinators() {
    let c = case();
    c.store
        .set_grant(1, c.org.anny, "financeiro.consultar_pagamento", None)
        .unwrap();
    let done = c.ask(c.org.lu, "O cliente ACME pagou?").await;
    assert!(done.result.unwrap().contains("Sem permissão"));
    assert_eq!(c.child(done.id)["tool_calls"][0]["status"], "denied");
    assert!(c.audit(done.id).contains(&"tool.call:denied".to_string()));

    // A coordinator never executes, even if someone tries to grant it.
    assert!(c
        .engine
        .grant(1, c.org.lu, "financeiro.consultar_pagamento", Some("allow"))
        .is_err());
    c.runtime.script(
        "Lu1",
        Arc::new(|turn: Turn| {
            Box::pin(async move {
                let reply = turn
                    .call("financeiro.consultar_pagamento", json!({"cliente": "ACME"}))
                    .await;
                let text = reply.content["erro"].as_str().unwrap_or_default().to_string();
                turn.call("concluir", json!({"resposta": text})).await;
                Outcome::Done
            })
        }),
    );
    let done = c.ask(c.org.lu, "Consulte direto").await;
    assert!(
        done.result.unwrap().contains("Coordenadores não executam"),
        "the coordinator was not blocked"
    );
}

#[tokio::test]
async fn invented_evidence_is_refused() {
    let c = case();
    c.runtime.script(
        "Lu1",
        Arc::new(|turn: Turn| {
            Box::pin(async move {
                let fake = turn
                    .call(
                        "concluir",
                        json!({"resposta": "ACME pagou", "evidencias": ["ev_inventada"]}),
                    )
                    .await;
                assert!(!fake.ok);
                turn.call("concluir", json!({"resposta": "Não verifiquei o pagamento."}))
                    .await;
                Outcome::Done
            })
        }),
    );
    let done = c.ask(c.org.lu, "O cliente ACME pagou?").await;
    assert_eq!(done.result.as_deref(), Some("Não verifiquei o pagamento."));
    assert!(c
        .audit(done.id)
        .contains(&"activity.conclude:unknown_evidence".to_string()));
}

#[tokio::test]
async fn provider_failures_retry_a_bounded_number_of_times_then_notify() {
    let c = case();
    c.runtime.script(
        "Lu1",
        Arc::new(|_turn: Turn| Box::pin(async { Outcome::Fail("provedor fora do ar".into()) })),
    );
    let done = c.ask(c.org.lu, "O cliente ACME pagou?").await;
    assert_eq!(done.status, "failed");
    assert_eq!(done.error.as_deref(), Some("provedor fora do ar"));
    assert_eq!(c.runtime.runs_of("Lu1"), 3);
    assert_eq!(c.channel.replies.lock().clone(), vec![(9, FAILURE_NOTICE.to_string())]);

    // A run that ends without `concluir` is a failed attempt too.
    c.runtime
        .script("Lu1", Arc::new(|_turn: Turn| Box::pin(async { Outcome::Done })));
    let done = c.ask(c.org.lu, "Outro pedido").await;
    assert_eq!(done.status, "failed");
    assert!(done.error.unwrap().contains("sem chamar `concluir`"));
}

#[tokio::test]
async fn a_stuck_run_times_out_and_the_retry_finishes() {
    let c = case();
    let mut policy = c.store.policy(1, c.org.lu).unwrap();
    policy.run_timeout_secs = 1;
    c.store.save_policy(&policy).unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let counter = runs.clone();
    let normal = lu_script();
    c.runtime.script(
        "Lu1",
        Arc::new(move |turn: Turn| {
            let first = counter.fetch_add(1, Ordering::SeqCst) == 0;
            let normal = normal.clone();
            Box::pin(async move {
                if first {
                    Outcome::Hang
                } else {
                    normal(turn).await
                }
            })
        }),
    );
    let done = c.ask(c.org.lu, "O cliente ACME pagou?").await;
    assert_eq!(done.status, "completed");
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    assert_eq!(c.runtime.cancelled.lock().len(), 1);
    let runs = c.store.runs(1, done.id).unwrap();
    assert!(runs[0].error.as_deref().unwrap().contains("Tempo esgotado"));
}

#[tokio::test]
async fn circular_delegation_is_blocked() {
    let c = case();
    // Anny tries to hand the work back to whoever has Lu's skill: Lu, already in the chain.
    c.runtime.script(
        "Anny1",
        Arc::new(|turn: Turn| {
            Box::pin(async move {
                let back = turn
                    .call("delegar", json!({"skill": "recepcao", "pedido": "Resolva você"}))
                    .await;
                let text = back.content["erro"].as_str().unwrap_or_default().to_string();
                turn.call("concluir", json!({"resposta": text})).await;
                Outcome::Done
            })
        }),
    );
    let done = c.ask(c.org.lu, "O cliente ACME pagou?").await;
    assert!(done.result.unwrap().contains("circular"));
    assert!(c.audit(done.id).contains(&"delegation.request:blocked".to_string()));
    c.runtime.script("Anny1", anny_script());
}

#[tokio::test]
async fn the_monthly_budget_stops_new_runs() {
    let c = case();
    let mut policy = c.store.policy(1, c.org.lu).unwrap();
    policy.monthly_token_budget = Some(500);
    c.store.save_policy(&policy).unwrap();
    assert_eq!(c.ask(c.org.lu, "O cliente ACME pagou?").await.status, "completed");
    let blocked = c.ask(c.org.lu, "O cliente Beta pagou?").await;
    assert_eq!(blocked.status, "failed");
    assert!(blocked.error.unwrap().contains("Orçamento"));
    assert_eq!(c.runtime.runs_of("Lu1"), 1);
}
