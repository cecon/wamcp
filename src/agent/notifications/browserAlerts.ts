import type { AppNotification } from '../types';
import { notificationText } from './notificationText';

/** Per-browser alert preferences (Chatwoot "Notificações de áudio/push"), kept in localStorage. */
export interface AlertPrefs {
  desktop: boolean;
  sound: boolean;
}
const KEY = 'wamcp.agent.alerts';
const DEFAULTS: AlertPrefs = { desktop: false, sound: false };

export function loadAlertPrefs(): AlertPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<AlertPrefs>;
    return { desktop: saved.desktop === true, sound: saved.sound === true };
  } catch {
    return DEFAULTS;
  }
}

export function saveAlertPrefs(prefs: AlertPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private mode, quota): alerts fall back to the defaults.
  }
}

const desktopApi = () => (typeof Notification === 'undefined' ? null : Notification);

/** Asks for desktop notification permission; must run from a user action (click). */
export async function requestDesktopPermission() {
  const api = desktopApi();
  if (!api) return false;
  if (api.permission === 'granted') return true;
  return (await api.requestPermission()) === 'granted';
}

type AudioContextClass = typeof AudioContext;
/** Two short sine tones generated on the fly (no audio file or network request). */
export function playChime() {
  const Context: AudioContextClass | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    [880, 1320].forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.15;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
  } catch {
    // Autoplay policies may block audio until the user interacts with the page.
  }
}

/** Alerts a new notification with the chime and/or a desktop notification, as configured. */
export function alertNotification(n: AppNotification, prefs = loadAlertPrefs()) {
  if (prefs.sound) playChime();
  const api = desktopApi();
  if (!prefs.desktop || api?.permission !== 'granted') return;
  try {
    new api('WA MCP', { body: notificationText(n), tag: `wamcp-notification-${n.id}` });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
