//! Cron expressions and the rules of agent schedules, without a database.
use chrono::{TimeZone, Utc};
use chrono_tz::Tz;
use wamcp_server::domain::agent_schedules::{
    build_schedule_prompt, check_subscriber, next_run, upcoming, validate_schedule,
};
use wamcp_server::domain::cron::Cron;
use wamcp_server::domain::model::{AgentScheduleDraft, RosterAgent, ScheduleRun};

fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
    Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap().timestamp()
}

fn next(expr: &str, after: i64, zone: Tz) -> i64 {
    Cron::parse(expr).unwrap().next_after(after, zone).unwrap()
}

#[test]
fn fields_accept_lists_ranges_and_steps() {
    let from = at(2026, 10, 29, 10, 7); // a Thursday
    assert_eq!(next("*/15 * * * *", from, Tz::UTC), at(2026, 10, 29, 10, 15));
    assert_eq!(next("5,50 * * * *", from, Tz::UTC), at(2026, 10, 29, 10, 50));
    assert_eq!(next("0 8-18/2 * * *", from, Tz::UTC), at(2026, 10, 29, 12, 0));
    assert_eq!(next("30 9 * * 0", from, Tz::UTC), at(2026, 11, 1, 9, 30));
    assert_eq!(
        next("30 9 * * 7", from, Tz::UTC),
        at(2026, 11, 1, 9, 30),
        "7 is Sunday too"
    );
    assert_eq!(next("0 0 1 1 *", from, Tz::UTC), at(2027, 1, 1, 0, 0));
    // Strictly after: a matching minute is not repeated.
    assert_eq!(next("7 10 * * *", from, Tz::UTC), at(2026, 10, 30, 10, 7));
}

#[test]
fn day_of_month_or_day_of_week_when_both_are_restricted() {
    let from = at(2026, 10, 29, 12, 0); // Thursday the 29th
                                        // The 1st of the month or any Friday: Friday the 30th comes first.
    assert_eq!(next("0 9 1 * 5", from, Tz::UTC), at(2026, 10, 30, 9, 0));
}

#[test]
fn local_time_zones_and_daylight_saving() {
    let sao_paulo: Tz = "America/Sao_Paulo".parse().unwrap();
    let from = at(2026, 10, 29, 10, 0);
    assert_eq!(next("0 9 * * *", from, sao_paulo), at(2026, 10, 29, 12, 0));
    // 02:30 does not exist in New York on 2026-03-08: that day is skipped.
    let new_york: Tz = "America/New_York".parse().unwrap();
    let before = at(2026, 3, 8, 5, 0);
    assert_eq!(next("30 2 * * *", before, new_york), at(2026, 3, 9, 6, 30));
}

#[test]
fn invalid_expressions_are_refused() {
    for bad in [
        "",
        "* * * *",
        "60 * * * *",
        "* 24 * * *",
        "* * 0 * *",
        "* * * 13 *",
        "*/0 * * * *",
        "5-1 * * * *",
        "a * * * *",
    ] {
        assert!(Cron::parse(bad).is_err(), "{bad}");
    }
    assert!(
        Cron::parse("0 0 30 2 *").unwrap().next_after(0, Tz::UTC).is_none(),
        "never matches"
    );
}

fn draft() -> AgentScheduleDraft {
    AgentScheduleDraft {
        name: "Resumo".into(),
        cron: None,
        interval_minutes: Some(30),
        timezone: "America/Sao_Paulo".into(),
        prompt: "Resuma o dia".into(),
        active: true,
    }
}

#[test]
fn schedules_need_exactly_one_rule_a_task_and_a_time_zone() {
    assert!(validate_schedule(&draft()).is_ok());
    let mut both = draft();
    both.cron = Some("* * * * *".into());
    assert!(validate_schedule(&both).is_err());
    let mut neither = draft();
    neither.interval_minutes = None;
    assert!(validate_schedule(&neither).is_err());
    let mut too_long = draft();
    too_long.interval_minutes = Some(8 * 24 * 60);
    assert!(validate_schedule(&too_long).is_err());
    let mut zone = draft();
    zone.timezone = "Marte/Olimpo".into();
    assert!(validate_schedule(&zone).is_err());
    let mut empty = draft();
    empty.prompt = "  ".into();
    assert!(validate_schedule(&empty).is_err());

    assert_eq!(next_run(&draft(), 1_000).unwrap(), Some(1_000 + 30 * 60_000));
    assert_eq!(upcoming(&draft(), 0, 3).unwrap(), [1_800_000, 3_600_000, 5_400_000]);
}

#[test]
fn only_ai_agents_with_a_runtime_subscribe_and_never_the_system_agent() {
    let agent: RosterAgent = serde_json::from_value(serde_json::json!({ "id": 1, "name": "Ana", "kind": "ai",
        "runtime": "claude_cli", "active": true, "skill_ids": [], "credential_count": 0, "created": "" }))
    .unwrap();
    assert!(check_subscriber(&agent).is_ok());
    let system = RosterAgent {
        system: true,
        ..agent.clone()
    };
    assert!(check_subscriber(&system).unwrap_err().to_string().contains("sistema"));
    let human = RosterAgent {
        kind: "human".into(),
        ..agent.clone()
    };
    assert!(check_subscriber(&human).is_err());
    let no_runtime = RosterAgent { runtime: None, ..agent };
    assert!(check_subscriber(&no_runtime).is_err());
}

#[test]
fn the_prompt_has_the_task_and_the_latest_outputs_oldest_first() {
    let run = |output: &str| ScheduleRun {
        id: 0,
        schedule_id: 1,
        agent_id: 1,
        agent_name: None,
        status: "done".into(),
        output: Some(output.into()),
        error: None,
        started_at: 0,
        finished_at: None,
    };
    let prompt = build_schedule_prompt("Seja breve.", "Resumo", "Resuma o dia", &[run("novo"), run("velho")]);
    assert!(prompt.starts_with("Suas instruções:\nSeja breve."));
    assert!(prompt.contains("Tarefa agendada \"Resumo\":\nResuma o dia"));
    assert!(prompt.find("velho").unwrap() < prompt.find("novo").unwrap());
}
