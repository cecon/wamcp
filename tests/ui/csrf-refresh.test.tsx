import { describe, expect, it } from 'vitest';
import { http, setCsrf } from '../../src/agent/api';
import { fakeApi, status } from './fake-api';

describe('CSRF token', () => {
  it('is asked for again when the server refuses it, and the request is sent once more', async () => {
    setCsrf(null); // as after a code update reloads the module: the session cookie is still valid
    const api = fakeApi({
      'GET /auth/me': { user: { id: 1 }, csrf: 'novo' },
    });
    let tries = 0;
    api.route('POST /agent_chats/3/messages', () => {
      tries += 1;
      const sent = api.called('POST', '/agent_chats/3/messages').at(-1)?.headers['X-CSRF-Token'];
      if (sent !== 'novo') throw status(403, 'Token CSRF inválido');
      return { id: 10 };
    });
    await expect(http('/agent_chats/3/messages', 'POST', { content: 'Oi' })).resolves.toEqual({ id: 10 });
    expect(tries).toBe(2);
    expect(api.called('GET', '/auth/me')).toHaveLength(1);
  });

  it('gives up after one new try', async () => {
    setCsrf('velho');
    const api = fakeApi({
      'GET /auth/me': { user: { id: 1 }, csrf: 'outro' },
      'POST /labels': () => {
        throw status(403, 'Token CSRF inválido');
      },
    });
    await expect(http('/labels', 'POST', {})).rejects.toThrow('Token CSRF inválido');
    expect(api.called('POST', '/labels')).toHaveLength(2);
  });
});
