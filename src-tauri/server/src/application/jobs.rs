//! Trabalhos periódicos do servidor: snoozes/SLA, webhooks, agendamentos, reentrega do GitHub,
//! vigia da IA e o flush dos eventos MCP.
use super::agent_schedules::AgentScheduleService;
use super::ai_watchdog::AiWatchdog;
use super::events::EventService;
use super::helpdesk::HelpdeskService;
use super::llm_bots::LlmBotService;
use super::webhooks::WebhookService;
use std::time::Duration;
use tokio::task::JoinHandle;

/// Sobe todos os jobs e devolve os handles para o servidor aguardar no shutdown.
pub fn start(
    helpdesk: HelpdeskService,
    webhooks: WebhookService,
    schedules: AgentScheduleService,
    llm_bots: Option<LlmBotService>,
    events: Option<EventService>,
) -> Vec<JoinHandle<()>> {
    let snooze_helpdesk = helpdesk.clone();
    let snoozes = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        loop {
            ticker.tick().await;
            let _ = snooze_helpdesk.wake_snoozed();
            let _ = snooze_helpdesk.auto_resolve().await;
            let _ = snooze_helpdesk.check_slas();
        }
    });
    let deliveries = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(10));
        loop {
            ticker.tick().await;
            let _ = webhooks.deliver_due().await;
        }
    });
    let scheduler = tokio::spawn(async move {
        let _ = schedules.recover();
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            let _ = schedules.run_due();
        }
    });
    let mut jobs = vec![snoozes, deliveries, scheduler, helpdesk.spawn_github_redelivery()];
    jobs.extend(AiWatchdog::spawn_optional(helpdesk, llm_bots));
    if let Some(events) = events {
        jobs.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(1));
            loop {
                ticker.tick().await;
                events.flush().await;
            }
        }));
    }
    jobs
}
