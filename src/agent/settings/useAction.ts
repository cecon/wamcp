import { useState } from 'react';

/** Runs an action and reports failures inline (shared by the settings forms). */
export function useAction() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}
