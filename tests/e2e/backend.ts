import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const origin = 'https://wamcp.cappyfy.com';
export const callback = 'https://chatgpt.com/connector/oauth/test-client';
const adminToken = 'a'.repeat(64);

/** Runs the real Rust backend (without the WhatsApp adapter) on free ports and a throwaway data dir. */
export async function startBackend() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-e2e-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const [adminPort, publicPort] = [port, port + 1];
  const child: ChildProcess = spawn(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '-p',
      'wamcp-server',
      '--no-default-features',
    ],
    {
      env: {
        ...process.env,
        WAMCP_DATA_DIR: dir,
        WAMCP_ADMIN_TOKEN: adminToken,
        WAMCP_ADMIN_PORT: String(adminPort),
        WAMCP_MCP_PORT: String(publicPort),
      },
      stdio: 'ignore',
    },
  );
  const url = `http://127.0.0.1:${publicPort}`,
    adminUrl = `http://127.0.0.1:${adminPort}`;
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      // still compiling or starting
    }
    if (attempt > 600) throw new Error('Backend Rust não iniciou');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const admin = async (route: string, body?: unknown) => {
    const response = await fetch(`${adminUrl}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json();
  };
  const form = (route: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body),
      redirect: 'manual',
    });
  return {
    url,
    admin,
    form,
    async session(name: string): Promise<{ id: string }> {
      return admin('/api/sessions', { name });
    },
    async register() {
      const response = await fetch(`${url}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ChatGPT test',
          redirect_uris: [callback],
          token_endpoint_auth_method: 'none',
        }),
      });
      return response.json();
    },
    async begin(clientId: string, resource: string) {
      const verifier = randomBytes(32).toString('base64url');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        scope: 'whatsapp:read whatsapp:send',
        state: 'state-to-preserve',
        resource,
      });
      const response = await fetch(`${url}/authorize?${params}`, { redirect: 'manual' });
      return { response, html: await response.text(), verifier };
    },
    rpc(token: string, sessionId: string) {
      return fetch(`${url}/mcp/${sessionId}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_profile', arguments: {} },
        }),
      });
    },
    async stop() {
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 300));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
