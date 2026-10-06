import { act } from '@testing-library/react';
import { vi } from 'vitest';

type Handler = (body: unknown, url: URL) => unknown;
/** A fixed JSON response or a handler computing it. */
export type Route = Handler | object;
export interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Routes `fetch` to in-memory handlers keyed by "METHOD /path"; a handler may throw `status(...)`. */
export function fakeApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname,
      search: url.search,
      body,
      headers: init.headers as Record<string, string>,
    });
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    if (!(key in routes)) return json({ error: `sem rota ${key}` }, 404);
    const route = routes[key];
    try {
      return json(typeof route === 'function' ? (route as Handler)(body, url) : route, 200);
    } catch (error) {
      if (error instanceof HttpStatus) return json({ error: error.message }, error.status);
      throw error;
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    route: (key: string, handler: Route) => (routes[key] = handler),
    called: (method: string, path: string) =>
      calls.filter((c) => c.method === method && (c.path === path || c.path === `/api/v1${path}`)),
  };
}

class HttpStatus extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const status = (code: number, message: string) => new HttpStatus(message, code);
const json = (data: unknown, code: number) =>
  new Response(JSON.stringify(data ?? null), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });

/** Minimal EventSource double; tests push server events with `FakeEventSource.emit`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
  close() {
    this.closed = true;
  }
  static emit(event: string, data: unknown) {
    act(() => {
      for (const source of FakeEventSource.instances)
        for (const listener of source.listeners.get(event) || [])
          listener(new MessageEvent(event, { data: JSON.stringify({ data }) }));
    });
  }
}
