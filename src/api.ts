import type { Meeting, MeetingPayload, Participant, SessionPayload } from "../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface NewMeeting {
  title: string;
  startUtc: number;
  endUtc: number;
  slotMinutes: number;
  tz: string;
  createdBy: string | null;
}

export const api = {
  createSession: (name: string) => req<{ id: string }>("POST", "/sessions", { name }),
  getSession: (sid: string) => req<SessionPayload>("GET", `/s/${sid}`),
  join: (sid: string, initials: string, tz: string) =>
    req<Participant>("POST", `/s/${sid}/participants`, { initials, tz }),
  updateTz: (sid: string, pid: string, tz: string) =>
    req<Participant>("PATCH", `/s/${sid}/participants/${pid}`, { tz }),
  createMeeting: (sid: string, input: NewMeeting) => req<Meeting>("POST", `/s/${sid}/meetings`, input),
  getMeeting: (sid: string, mid: string) => req<MeetingPayload>("GET", `/s/${sid}/m/${mid}`),
  updateMeeting: (
    sid: string,
    mid: string,
    patch: { title?: string; chosenStart?: number | null; chosenEnd?: number | null },
  ) => req<Meeting>("PATCH", `/s/${sid}/m/${mid}`, patch),
  deleteMeeting: (sid: string, mid: string) => req<{ ok: true }>("DELETE", `/s/${sid}/m/${mid}`),
  saveAvailability: (sid: string, mid: string, pid: string, slots: number[]) =>
    req<{ slots: number[] }>("PUT", `/s/${sid}/m/${mid}/availability/${pid}`, { slots }),
};
