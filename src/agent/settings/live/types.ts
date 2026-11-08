/** `GET /agents/live`: each AI agent and what it is doing now. */
export interface LiveAnswer {
  kind: 'conversation' | 'chat';
  id: number;
  display_id: number | null;
  agent_id: number | null;
  running: boolean;
  since: number | null;
}

export interface LiveActivity {
  id: number;
  status: string;
  request: string;
  created: string;
}

export interface LiveAgent {
  id: number;
  name: string;
  active: boolean;
  paused: boolean;
  answers: LiveAnswer[];
  activities: LiveActivity[];
}
