//! Tables of the agentic engine (see `docs/engine/spec.md`). Every table carries the organization
//! (`account_id`) and every engine query filters on it.
pub const ENGINE: &str = "
-- OpenClaude leaves the product (license risk): its agents and LLM bots move to OpenCode, the same
-- OpenRouter model now named provedor/modelo.
UPDATE agents SET runtime='opencode',
  model=CASE WHEN model IS NULL OR trim(model)='' THEN NULL ELSE 'openrouter/'||trim(model) END
  WHERE runtime='openclaude';
UPDATE agent_bots SET provider='opencode',
  model=CASE WHEN model IS NULL OR trim(model)='' THEN NULL ELSE 'openrouter/'||trim(model) END
  WHERE provider='openclaude';
UPDATE agents SET instructions=replace(instructions,'openclaude com OpenRouter','opencode com qualquer provedor (provedor/modelo, OpenRouter incluído)')
  WHERE instructions LIKE '%openclaude com OpenRouter%';
UPDATE skills SET instructions=replace(instructions,'openclaude com OpenRouter','opencode com qualquer provedor (provedor/modelo, OpenRouter incluído)')
  WHERE instructions LIKE '%openclaude com OpenRouter%';
-- SQLite cannot add a REFERENCES column with a default; the engine checks the organization itself.
ALTER TABLE agents ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX agents_account ON agents(account_id);
CREATE TABLE engine_agent_policies(agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),enabled INTEGER NOT NULL DEFAULT 1,
  proactive_enabled INTEGER NOT NULL DEFAULT 0,
  execution_policy TEXT NOT NULL DEFAULT 'approval_for_sensitive'
    CHECK(execution_policy IN ('suggest_only','approval_for_sensitive','within_grants')),
  max_concurrency INTEGER NOT NULL DEFAULT 2 CHECK(max_concurrency BETWEEN 1 AND 10),
  run_timeout_secs INTEGER NOT NULL DEFAULT 180 CHECK(run_timeout_secs BETWEEN 1 AND 3600),
  monthly_token_budget INTEGER CHECK(monthly_token_budget IS NULL OR monthly_token_budget>=0));
CREATE TABLE engine_tool_grants(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,tool TEXT NOT NULL,
  effect TEXT NOT NULL CHECK(effect IN ('allow','approval')),created TEXT NOT NULL,UNIQUE(account_id,agent_id,tool));
CREATE TABLE engine_activities(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  requester TEXT NOT NULL,agent_id INTEGER NOT NULL REFERENCES agents(id),
  parent_id INTEGER REFERENCES engine_activities(id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','completed','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,deadline TEXT,request TEXT NOT NULL,result TEXT,
  evidence TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence)),error TEXT,idempotency_key TEXT,
  conversation_id INTEGER,correlation_id TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
  reply_state TEXT CHECK(reply_state IS NULL OR reply_state IN ('sending','sent')),
  created TEXT NOT NULL,updated TEXT NOT NULL,UNIQUE(account_id,idempotency_key));
CREATE INDEX engine_activities_status ON engine_activities(account_id,status);
CREATE INDEX engine_activities_parent ON engine_activities(parent_id);
CREATE TABLE engine_delegations(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  parent_activity_id INTEGER NOT NULL REFERENCES engine_activities(id),
  activity_id INTEGER NOT NULL UNIQUE REFERENCES engine_activities(id),
  from_agent_id INTEGER NOT NULL REFERENCES agents(id),to_agent_id INTEGER NOT NULL REFERENCES agents(id),
  skill TEXT NOT NULL,reason TEXT,request_key TEXT NOT NULL,correlation_id TEXT NOT NULL,
  depth INTEGER NOT NULL,hops INTEGER NOT NULL,created TEXT NOT NULL,UNIQUE(parent_activity_id,request_key));
CREATE TABLE engine_runs(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  activity_id INTEGER NOT NULL REFERENCES engine_activities(id),agent_id INTEGER NOT NULL REFERENCES agents(id),
  runtime TEXT NOT NULL,model TEXT,external_id TEXT,token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
  attempt INTEGER NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,cost_usd REAL,
  cost_source TEXT CHECK(cost_source IS NULL OR cost_source IN ('reported','estimated')),
  error TEXT,started TEXT NOT NULL,finished TEXT);
CREATE INDEX engine_runs_activity ON engine_runs(activity_id);
CREATE INDEX engine_runs_agent ON engine_runs(account_id,agent_id,started);
CREATE TABLE engine_tool_calls(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  activity_id INTEGER NOT NULL REFERENCES engine_activities(id),run_id INTEGER NOT NULL REFERENCES engine_runs(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id),tool TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(args)),call_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','denied','failed','pending_approval','rejected')),
  result TEXT CHECK(result IS NULL OR json_valid(result)),evidence_id TEXT,decided_by INTEGER,
  created TEXT NOT NULL,UNIQUE(activity_id,call_key));
CREATE TABLE engine_evidence(id TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  activity_id INTEGER NOT NULL REFERENCES engine_activities(id),tool_call_id INTEGER REFERENCES engine_tool_calls(id),
  source TEXT NOT NULL,content TEXT NOT NULL CHECK(json_valid(content)),created TEXT NOT NULL);
CREATE INDEX engine_evidence_activity ON engine_evidence(activity_id);
CREATE TABLE engine_messages(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  activity_id INTEGER NOT NULL REFERENCES engine_activities(id),from_agent_id INTEGER,to_agent_id INTEGER,
  body TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX engine_messages_activity ON engine_messages(activity_id);
CREATE TABLE engine_audit(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  activity_id INTEGER,agent_id INTEGER,action TEXT NOT NULL,outcome TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),at TEXT NOT NULL);
CREATE INDEX engine_audit_account ON engine_audit(account_id,at);
CREATE TABLE engine_memories(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('episodic','semantic','operational')),content TEXT NOT NULL,source TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','organization')),
  valid_until TEXT,version INTEGER NOT NULL DEFAULT 1,supersedes INTEGER REFERENCES engine_memories(id),
  deleted INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
CREATE INDEX engine_memories_agent ON engine_memories(account_id,agent_id,deleted);
";

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn openclaude_agents_and_bots_move_to_opencode() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE agents(id INTEGER PRIMARY KEY,runtime TEXT,model TEXT,instructions TEXT);
             CREATE TABLE agent_bots(id INTEGER PRIMARY KEY,provider TEXT,model TEXT);
             CREATE TABLE skills(id INTEGER PRIMARY KEY,instructions TEXT);
             INSERT INTO agents VALUES(1,'openclaude','openai/gpt-4o-mini',NULL),(2,'openclaude','',NULL),
               (3,'claude_cli','sonnet','Runtimes: codex_cli; openclaude com OpenRouter.');
             INSERT INTO skills VALUES(1,'use openclaude com OpenRouter');
             INSERT INTO agent_bots VALUES(1,'openclaude',' openai/gpt-5 '),(2,'codex_cli',NULL);",
        )
        .unwrap();
        let moves = super::ENGINE
            .split("ALTER TABLE agents ADD COLUMN account_id")
            .next()
            .unwrap();
        db.execute_batch(moves).unwrap();
        let rows = |sql: &str| -> Vec<(String, Option<String>)> {
            let mut statement = db.prepare(sql).unwrap();
            statement
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(
            rows("SELECT runtime,model FROM agents ORDER BY id"),
            vec![
                ("opencode".into(), Some("openrouter/openai/gpt-4o-mini".into())),
                ("opencode".into(), None),
                ("claude_cli".into(), Some("sonnet".into())),
            ]
        );
        let texts =
            rows("SELECT instructions,NULL FROM agents WHERE id=3 UNION ALL SELECT instructions,NULL FROM skills");
        assert!(
            texts
                .iter()
                .all(|(t, _)| !t.contains("openclaude") && t.contains("opencode")),
            "{texts:?}"
        );
        assert_eq!(
            rows("SELECT provider,model FROM agent_bots ORDER BY id"),
            vec![
                ("opencode".into(), Some("openrouter/openai/gpt-5".into())),
                ("codex_cli".into(), None)
            ]
        );
    }
}
