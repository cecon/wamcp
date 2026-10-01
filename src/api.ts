import { invoke, isTauri } from '@tauri-apps/api/core';
let browserToken = '';
export function setBrowserToken(token: string) {
  browserToken = token;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (isTauri()) return invoke<T>('api_request', { path, method, body: body ?? null });
  const response = await fetch(`http://127.0.0.1:17381${path}`, {
    method,
    headers: { Authorization: `Bearer ${browserToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Informe o token administrativo local para abrir a prévia.'
        : 'Não foi possível concluir a operação.',
    );
  return response.json();
}
export const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
