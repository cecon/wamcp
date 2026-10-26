import { useCallback, useEffect, useState } from 'react';
import type { Realtime } from '../../api';
import { catalogApi } from '../catalogApi';
import type { ImportJob, ImportStatus } from '../types';

/** Statuses during which the crawler is still working (polled). */
export const RUNNING: ImportStatus[] = ['starting', 'opening', 'waiting_human', 'loading'];
/** Statuses followed by polling: the crawl, then applying the preview (photo download progress). */
const POLLED: ImportStatus[] = [...RUNNING, 'applying'];
const FINISHED: ImportStatus[] = ['applied', 'failed', 'cancelled'];
const KEY = 'wamcp.catalog.import';

function remember(job: ImportJob | null) {
  try {
    if (job && (POLLED.includes(job.status) || job.status === 'ready')) localStorage.setItem(KEY, job.id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: resuming an import after leaving the page is a convenience only.
  }
}
function remembered() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Current iFood import: resumes the one left running, polls GET /catalog/imports/{id} every `pollMs`
 * while the crawler works or the preview is being applied, and applies `catalog.import.updated` events as they arrive.
 */
export function useImportJob(realtime?: Realtime, pollMs = 2000) {
  const [job, setJobState] = useState<ImportJob | null>(null);
  const setJob = useCallback((next: ImportJob | null) => {
    remember(next);
    setJobState(next);
  }, []);
  const merge = useCallback(
    (update: Partial<ImportJob> & { id: string }) =>
      setJobState((current) => {
        // A late poll or event must not reopen an import that already finished here.
        if (!current || current.id !== update.id || FINISHED.includes(current.status)) return current;
        // Nor a poll answered just before the server started applying (a failed apply resets it).
        if (current.status === 'applying' && update.status === 'ready') return current;
        const next = { ...current, ...update };
        remember(next);
        return next;
      }),
    [],
  );
  useEffect(() => {
    const id = remembered();
    if (id)
      catalogApi
        .importJob(id)
        .then(setJob)
        .catch(() => setJob(null));
  }, [setJob]);
  const id = job?.id;
  const polled = Boolean(job && POLLED.includes(job.status));
  useEffect(() => {
    if (!id || !polled) return;
    const timer = setInterval(() => {
      catalogApi
        .importJob(id)
        .then(merge)
        .catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [id, polled, pollMs, merge]);
  useEffect(
    () =>
      realtime?.subscribe(({ event, data }) => {
        if (event === 'catalog.import.updated' && typeof data.id === 'string')
          merge(data as unknown as ImportJob);
      }),
    [realtime, merge],
  );
  return { job, setJob };
}
