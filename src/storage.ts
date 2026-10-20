// Per-browser conveniences. Everything here is optional: the app works if storage is blocked.

function read<T>(key: string, fallback: T, store: () => Storage = () => localStorage): T {
  try {
    const raw = store().getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, store: () => Storage = () => localStorage) {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage; the user just rejoins next time.
  }
}

/**
 * Who you are in this tab, per session. Kept in sessionStorage so every new tab
 * (incognito or not) asks again, which makes switching between friends easy.
 */
export const getMe = (sid: string) => read<string | null>(`sz:me:${sid}`, null, () => sessionStorage);
export const setMe = (sid: string, pid: string | null) => write(`sz:me:${sid}`, pid, () => sessionStorage);

/** Who this browser picked last time, to highlight in the picker. */
export const getLastMe = (sid: string) => read<string | null>(`sz:last:${sid}`, null);
export const setLastMe = (sid: string, pid: string) => write(`sz:last:${sid}`, pid);

export interface RecentSession {
  id: string;
  name: string;
  openedAt: number;
}

export const recentSessions = () => read<RecentSession[]>("sz:recent", []);
export function rememberSession(id: string, name: string) {
  const rest = recentSessions().filter((s) => s.id !== id);
  write("sz:recent", [{ id, name, openedAt: Date.now() }, ...rest].slice(0, 12));
}
export function forgetSession(id: string) {
  write("sz:recent", recentSessions().filter((s) => s.id !== id));
}

export const getPref = <T,>(key: string, fallback: T) => read<T>(`sz:pref:${key}`, fallback);
export const setPref = (key: string, value: unknown) => write(`sz:pref:${key}`, value);
