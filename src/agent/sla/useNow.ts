import { useEffect, useState } from 'react';

/** Current time in epoch seconds, refreshed every `everyMs` (countdowns). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
