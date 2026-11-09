import { useEffect } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { AgentLink } from '../../agentPage/AgentLink';

import { useFetch } from '../../useFetch';
import { RUN_LABEL, formatTime, type AgentSchedule, type ScheduleRun } from './types';

const TONE: Record<ScheduleRun['status'], string> = {
  running: 'info.light',
  done: 'success.light',
  failed: 'error.light',
  skipped: 'warning.light',
};

const TEXT_TONE: Record<ScheduleRun['status'], string> = {
  running: 'info.dark',
  done: 'success.dark',
  failed: 'error.dark',
  skipped: 'warning.dark',
};

/** The newest runs of a schedule, refreshed while one is going on. */
export function RunHistory({ schedule, refresh }: { schedule: AgentSchedule; refresh: number }) {
  const { data, error, reload } = useFetch<ScheduleRun[]>(`/agent_schedules/${schedule.id}/runs`);
  const running = data?.some((r) => r.status === 'running');
  useEffect(reload, [refresh, reload]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [running, reload]);

  if (error) {
    return (
      <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
        {error}
      </Typography>
    );
  }
  if (data?.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nenhuma execução ainda.
      </Typography>
    );
  }
  return (
    <Stack component="ol" aria-label="Execuções" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {data?.map((run) => (
        <Paper component="li" key={run.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              <AgentLink agentId={run.agent_id}>{run.agent_name ?? `Agente ${run.agent_id}`}</AgentLink>
            </Typography>
            <Box
              sx={{
                bgcolor: TONE[run.status],
                color: TEXT_TONE[run.status],
                borderRadius: 1,
                px: 1,
                py: 0.25,
              }}
            >
              <Typography variant="caption">{RUN_LABEL[run.status]}</Typography>
            </Box>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {formatTime(run.started_at, schedule.timezone)}
            {run.finished_at && run.status !== 'skipped' && (
              <> · {Math.max(0, Math.round((run.finished_at - run.started_at) / 1000))} s</>
            )}
          </Typography>
          {run.output && (
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
              {run.output}
            </Typography>
          )}
          {run.error && (
            <Typography variant="body2" sx={{ mt: 1, color: 'error.main' }}>
              {run.error}
            </Typography>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
