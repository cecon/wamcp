/** Small browser helpers for the profile page: clipboard, local text files and session labels. */

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Saves text generated in the page (no request to the server). */
export function saveTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/Tauri|wamcp/i, 'Aplicativo WA MCP'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];
const find = (list: [RegExp, string][], text: string) => list.find(([pattern]) => pattern.test(text))?.[1];

/** "Chrome no Windows" from a user agent string. */
export function describeUserAgent(userAgent: string | null) {
  if (!userAgent) return 'Navegador desconhecido';
  const browser = find(BROWSERS, userAgent) || 'Navegador';
  const system = find(SYSTEMS, userAgent);
  return system ? `${browser} no ${system}` : browser;
}

/** ISO date (sessions) or epoch seconds (audit log) in pt-BR. */
export function formatDateTime(value: string | number | null) {
  if (value === null || value === '') return '—';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
