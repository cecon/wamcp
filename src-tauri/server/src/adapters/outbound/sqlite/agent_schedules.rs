use super::db::{int, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::AgentScheduleRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AgentSchedule, AgentScheduleDraft, ScheduleRun};
use rusqlite::types::Value as Sql;

/// Schedules with their subscribed agents (a JSON array of ids).
const SCHEDULE: &str = "SELECT s.*,(SELECT json_group_array(agent_id) FROM
  (SELECT agent_id FROM agent_schedule_agents WHERE schedule_id=s.id ORDER BY agent_id)) AS agent_ids
  FROM agent_schedules s";
const SCHEDULE_SHAPE: Shape = Shape {
    json: &["agent_ids"],
    bools: &["active"],
};
const RUN: &str = "SELECT r.*,a.name AS agent_name FROM agent_schedule_runs r LEFT JOIN agents a ON a.id=r.agent_id";

fn fields(draft: &AgentScheduleDraft) -> Vec<Sql> {
    vec![
        text(draft.name.trim()),
        opt_text(draft.cron.as_deref().map(str::trim)),
        opt_int(draft.interval_minutes),
        text(draft.timezone.trim()),
        text(draft.prompt.trim()),
        int(i64::from(draft.active)),
    ]
}

impl SqliteStore {
    fn run(&self, id: i64) -> Result<ScheduleRun> {
        self.row(&format!("{RUN} WHERE r.id=?"), vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("schedule run vanished"))
    }
}

impl AgentScheduleRepo for SqliteStore {
    fn agent_schedules(&self) -> Result<Vec<AgentSchedule>> {
        self.rows(
            &format!("{SCHEDULE} ORDER BY s.name COLLATE NOCASE,s.id"),
            vec![],
            SCHEDULE_SHAPE,
        )
    }

    fn agent_schedule(&self, id: i64) -> Result<Option<AgentSchedule>> {
        self.row(&format!("{SCHEDULE} WHERE s.id=?"), vec![int(id)], SCHEDULE_SHAPE)
    }

    fn create_agent_schedule(
        &self,
        draft: &AgentScheduleDraft,
        created_by: i64,
        next_run_at: Option<i64>,
        at: i64,
    ) -> Result<i64> {
        let mut params = fields(draft);
        params.extend([int(created_by), opt_int(next_run_at), int(at)]);
        self.insert(
            "INSERT INTO agent_schedules(name,cron,interval_minutes,timezone,prompt,active,created_by,next_run_at,
               created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            params,
        )
    }

    fn update_agent_schedule(&self, id: i64, draft: &AgentScheduleDraft, next_run_at: Option<i64>) -> Result<()> {
        let mut params = fields(draft);
        params.extend([opt_int(next_run_at), int(id)]);
        self.exec(
            "UPDATE agent_schedules SET name=?,cron=?,interval_minutes=?,timezone=?,prompt=?,active=?,next_run_at=?
               WHERE id=?",
            params,
        )?;
        Ok(())
    }

    fn delete_agent_schedule(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM agent_schedules WHERE id=?", vec![int(id)])?;
        Ok(())
    }

    fn set_schedule_agent(&self, schedule_id: i64, agent_id: i64, subscribed: bool) -> Result<()> {
        let sql = if subscribed {
            "INSERT OR IGNORE INTO agent_schedule_agents(schedule_id,agent_id) VALUES(?,?)"
        } else {
            "DELETE FROM agent_schedule_agents WHERE schedule_id=? AND agent_id=?"
        };
        self.exec(sql, vec![int(schedule_id), int(agent_id)])?;
        Ok(())
    }

    fn due_agent_schedules(&self, now: i64) -> Result<Vec<AgentSchedule>> {
        self.rows(
            &format!("{SCHEDULE} WHERE s.active=1 AND s.next_run_at<=? ORDER BY s.next_run_at,s.id"),
            vec![int(now)],
            SCHEDULE_SHAPE,
        )
    }

    fn mark_schedule_run(&self, id: i64, last_run_at: i64, next_run_at: Option<i64>) -> Result<()> {
        self.exec(
            "UPDATE agent_schedules SET last_run_at=?,next_run_at=? WHERE id=?",
            vec![int(last_run_at), opt_int(next_run_at), int(id)],
        )?;
        Ok(())
    }

    fn start_schedule_run(&self, schedule_id: i64, agent_id: i64, status: &str, at: i64) -> Result<ScheduleRun> {
        let id = self.insert(
            "INSERT INTO agent_schedule_runs(schedule_id,agent_id,status,started_at) VALUES(?,?,?,?)",
            vec![int(schedule_id), int(agent_id), text(status), int(at)],
        )?;
        self.run(id)
    }

    fn finish_schedule_run(
        &self,
        id: i64,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
        at: i64,
    ) -> Result<ScheduleRun> {
        self.exec(
            "UPDATE agent_schedule_runs SET status=?,output=?,error=?,finished_at=? WHERE id=?",
            vec![text(status), opt_text(output), opt_text(error), int(at), int(id)],
        )?;
        self.run(id)
    }

    fn schedule_runs(&self, schedule_id: i64, limit: i64) -> Result<Vec<ScheduleRun>> {
        self.rows(
            &format!("{RUN} WHERE r.schedule_id=? ORDER BY r.id DESC LIMIT ?"),
            vec![int(schedule_id), int(limit)],
            PLAIN,
        )
    }

    fn schedule_outputs(&self, schedule_id: i64, agent_id: i64, limit: i64) -> Result<Vec<ScheduleRun>> {
        self.rows(
            &format!(
                "{RUN} WHERE r.schedule_id=? AND r.agent_id=? AND r.status='done' AND r.output IS NOT NULL
                 ORDER BY r.id DESC LIMIT ?"
            ),
            vec![int(schedule_id), int(agent_id), int(limit)],
            PLAIN,
        )
    }

    fn fail_unfinished_runs(&self, error: &str, at: i64) -> Result<usize> {
        self.exec(
            "UPDATE agent_schedule_runs SET status='failed',error=?,finished_at=? WHERE status='running'",
            vec![text(error), int(at)],
        )
    }
}
