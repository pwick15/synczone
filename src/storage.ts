// Per-browser conveniences. Everything here is optional: the app works if storage is blocked.

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage; the user just rejoins next time.
  }
}

/** Which participant this browser is, per session. */
export const getMe = (sid: string) => read<string | null>(`sz:me:${sid}`, null);
export const setMe = (sid: string, pid: string | null) => write(`sz:me:${sid}`, pid);

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
