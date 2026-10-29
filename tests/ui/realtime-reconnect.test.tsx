import { describe, expect, it, vi } from 'vitest';
import { connectRealtime, REALTIME_RECONNECTED } from '../../src/agent/api';
import { FakeEventSource } from './fake-api';

describe('realtime stream', () => {
  it('opens the stream again when the browser gives up, and says so to the listeners', () => {
    vi.useFakeTimers();
    try {
      FakeEventSource.instances = [];
      const online = vi.fn(),
        events: string[] = [];
      const realtime = connectRealtime(online, 1000);
      realtime.subscribe((e) => events.push(e.event));
      const first = FakeEventSource.instances[0];
      first.onopen?.();
      expect(events).toEqual([]);

      // The server restarts: the retry gets an error response and the browser closes the stream.
      first.readyState = FakeEventSource.CLOSED;
      first.onerror?.();
      expect(online).toHaveBeenLastCalledWith(false);
      vi.advanceTimersByTime(1000);
      const second = FakeEventSource.instances[1];
      expect(second).toBeDefined();
      second.onopen?.();
      expect(online).toHaveBeenLastCalledWith(true);
      expect(events).toEqual([REALTIME_RECONNECTED]);

      // Closed on purpose: no new stream.
      second.readyState = FakeEventSource.CLOSED;
      realtime.close();
      second.onerror?.();
      vi.advanceTimersByTime(5000);
      expect(FakeEventSource.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
