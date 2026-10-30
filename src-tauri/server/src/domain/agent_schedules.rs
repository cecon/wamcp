//! Rules of the schedules AI agents subscribe to: what a valid schedule is, when it runs next, who may
//! subscribe and the prompt of a run.
use super::cron::{zone, Cron};
use super::error::{fail, Result};
use super::model::{AgentScheduleDraft, RosterAgent, ScheduleRun};

pub const DEFAULT_TIMEZONE: &str = "America/Sao_Paulo";
/// Shortest and longest interval (one minute to one week).
pub const MIN_INTERVAL: i64 = 1;
pub const MAX_INTERVAL: i64 = 7 * 24 * 60;
const MAX_NAME: usize = 80;
const MAX_PROMPT: usize = 8000;
/// How many earlier outputs of the same agent and schedule a run sees.
pub const PREVIOUS_RUNS: i64 = 3;
/// Longest output kept from an earlier run in the prompt.
const PREVIOUS_OUTPUT: usize = 1500;

/// Checks a draft: a name, a task, a valid time zone and exactly one of a cron expression or an interval.
pub fn validate_schedule(draft: &AgentScheduleDraft) -> Result<()> {
    let name = draft.name.trim().chars().count();
    if name == 0 || name > MAX_NAME {
        return fail(format!("O nome precisa ter entre 1 e {MAX_NAME} caracteres"));
    }
    let prompt = draft.prompt.trim().chars().count();
    if prompt == 0 || prompt > MAX_PROMPT {
        return fail(format!("A tarefa precisa ter entre 1 e {MAX_PROMPT} caracteres"));
    }
    zone(&draft.timezone)?;
    match (&draft.cron, draft.interval_minutes) {
        (Some(cron), None) => Cron::parse(cron).map(drop),
        (None, Some(minutes)) if (MIN_INTERVAL..=MAX_INTERVAL).contains(&minutes) => Ok(()),
        (None, Some(_)) => fail(format!(
            "O intervalo precisa ser de {MIN_INTERVAL} a {MAX_INTERVAL} minutos"
        )),
        _ => fail("Informe uma expressão cron ou um intervalo em minutos (só um dos dois)"),
    }
}

/// When the schedule runs next after `after_ms` (epoch milliseconds): the next cron match, or one
/// interval later. A run missed while the app was off happens once, then this restarts from now.
pub fn next_run(draft: &AgentScheduleDraft, after_ms: i64) -> Result<Option<i64>> {
    if let Some(minutes) = draft.interval_minutes {
        return Ok(Some(after_ms + minutes * 60_000));
    }
    let Some(cron) = &draft.cron else {
        return Ok(None);
    };
    let found = Cron::parse(cron)?.next_after(after_ms.div_euclid(1000), zone(&draft.timezone)?);
    Ok(found.map(|seconds| seconds * 1000))
}

/// The next `count` runs after `after_ms`, for the cron helper of the UI.
pub fn upcoming(draft: &AgentScheduleDraft, after_ms: i64, count: usize) -> Result<Vec<i64>> {
    let mut times = Vec::new();
    let mut at = after_ms;
    while times.len() < count {
        match next_run(draft, at)? {
            Some(next) => {
                times.push(next);
                at = next;
            }
            None => break,
        }
    }
    Ok(times)
}

/// AI agents with a runtime may subscribe; the system agent only helps administrators set the app up,
/// so it is never scheduled.
pub fn check_subscriber(agent: &RosterAgent) -> Result<()> {
    if agent.system {
        return fail("O funcionário do sistema só ajuda os administradores; ele não pode ser agendado");
    }
    if agent.kind != "ai" {
        return fail("Somente agentes de IA se inscrevem em agendamentos");
    }
    if agent.runtime.is_none() {
        return fail("O agente precisa ter um runtime configurado");
    }
    Ok(())
}

/// Whether the agent may run now (it may have been turned off or changed since it subscribed).
pub fn runs_schedules(agent: &RosterAgent) -> bool {
    check_subscriber(agent).is_ok() && agent.active
}

pub const SCHEDULE_SYSTEM: &str = "Você é um agente de IA da equipe desta empresa executando sozinho uma tarefa \
agendada, sem ninguém esperando na conversa agora. Faça a tarefa seguindo as suas instruções e skills e responda \
em português do Brasil com o resultado, de forma direta (é isso que a pessoa que criou o agendamento vai ler). Se \
não houver nada a relatar, diga isso em uma frase. Nunca invente dados.";

/// The prompt of a run: the agent's instructions, the task and the agent's latest outputs for it.
pub fn build_schedule_prompt(instructions: &str, name: &str, task: &str, previous: &[ScheduleRun]) -> String {
    let mut prompt = String::new();
    if !instructions.trim().is_empty() {
        prompt.push_str(&format!("Suas instruções:\n{}\n\n", instructions.trim()));
    }
    prompt.push_str(&format!("Tarefa agendada \"{}\":\n{}\n", name.trim(), task.trim()));
    let earlier: Vec<&str> = previous.iter().filter_map(|r| r.output.as_deref()).collect();
    if !earlier.is_empty() {
        prompt.push_str("\nO que você relatou nas últimas execuções (da mais antiga à mais recente):\n");
        for output in earlier.iter().rev() {
            let short: String = output.chars().take(PREVIOUS_OUTPUT).collect();
            prompt.push_str(&format!("- {}\n", short.trim()));
        }
    }
    prompt
}
