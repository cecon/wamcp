import type { BreakdownRow, ReportSummary } from '../../src/agent/parityTypes';
import type { Call } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

export const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

/** Summary with growth, drops, no change and metrics without a previous period. */
export const summary: ReportSummary = {
  conversations_count: { current: 12, previous: 10 },
  incoming_messages_count: { current: 40, previous: 0 },
  outgoing_messages_count: { current: 35, previous: 50 },
  resolutions_count: { current: 8, previous: 8 },
  avg_first_response_time: { current: 125, previous: 100 },
  avg_resolution_time: { current: 7400, previous: 0 },
};
/** 2026-10-05 and 2026-10-06 (UTC bucket starts). */
export const series = [
  { timestamp: 1791158400, value: 3 },
  { timestamp: 1791244800, value: 0 },
];

export const row = (id: number | null, name: string, fields: Partial<BreakdownRow> = {}): BreakdownRow => ({
  id,
  name,
  conversations_count: 5,
  incoming_messages_count: 9,
  outgoing_messages_count: 7,
  resolutions_count: 3,
  avg_first_response_time: 30,
  avg_resolution_time: 3600,
  ...fields,
});

/** Query parameters of the latest call. */
export const params = (calls: Call[]) => new URLSearchParams(calls.at(-1)!.search);
