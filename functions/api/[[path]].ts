import type {
  Meeting,
  MeetingPayload,
  MeetingSummary,
  Participant,
  SessionPayload,
} from "../../shared/types";
import { INITIALS_RE, MAX_DAYS, SLOT_OPTIONS } from "../../shared/types";

interface Env {
  DB: D1Database;
}

type Ctx = EventContext<Env, string, Record<string, unknown>>;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  // 59-char alphabet; modulo bias is negligible for an id.
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  return value.trim().slice(0, max);
}

function cleanTz(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "tz is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new HttpError(400, "Unknown time zone");
  }
  return value;
}

interface MeetingRow {
  id: string;
  title: string;
  start_utc: number;
  end_utc: number;
  slot_minutes: number;
  tz: string;
  created_by: string | null;
  chosen_start: number | null;
  chosen_end: number | null;
  created_at: number;
}

const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  title: r.title,
  startUtc: r.start_utc,
  endUtc: r.end_utc,
  slotMinutes: r.slot_minutes,
  tz: r.tz,
  createdBy: r.created_by,
  chosenStart: r.chosen_start,
  chosenEnd: r.chosen_end,
  createdAt: r.created_at,
});

const slotCount = (m: Meeting) => Math.round((m.endUtc - m.startUtc) / (m.slotMinutes * 60_000));

async function requireSession(db: D1Database, sid: string) {
  const row = await db
    .prepare("SELECT id, name, created_at FROM sessions WHERE id = ?")
    .bind(sid)
    .first<{ id: string; name: string; created_at: number }>();
  if (!row) throw new HttpError(404, "Session not found");
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function requireMeeting(db: D1Database, sid: string, mid: string): Promise<Meeting> {
  const row = await db
    .prepare("SELECT * FROM meetings WHERE id = ? AND session_id = ?")
    .bind(mid, sid)
    .first<MeetingRow>();
  if (!row) throw new HttpError(404, "Meeting not found");
  return toMeeting(row);
}

async function requireParticipant(db: D1Database, sid: string, pid: string): Promise<Participant> {
  const row = await db
    .prepare("SELECT id, initials, tz, color FROM participants WHERE id = ? AND session_id = ?")
    .bind(pid, sid)
    .first<Participant>();
  if (!row) throw new HttpError(404, "Participant not found");
  return row;
}

async function route(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const db = env.DB;
  const method = request.method;
  const parts = new URL(request.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  // POST /api/sessions
  if (parts.length === 1 && parts[0] === "sessions" && method === "POST") {
    const { name } = await body<{ name?: unknown }>(request);
    const id = randomId(12);
    const clean = cleanText(name, "name", 80);
    await db
      .prepare("INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)")
      .bind(id, clean, Date.now())
      .run();
    return json({ id }, 201);
  }

  if (parts[0] !== "s" || !parts[1]) throw new HttpError(404, "Not found");
  const sid = parts[1];
  const rest = parts.slice(2);

  // GET /api/s/:sid
  if (rest.length === 0 && method === "GET") {
    const session = await requireSession(db, sid);
    const [participants, meetings] = await db.batch([
      db
        .prepare("SELECT id, initials, tz, color FROM participants WHERE session_id = ? ORDER BY created_at")
        .bind(sid),
      db
        .prepare(
          `SELECT m.*, (SELECT COUNT(*) FROM availability a WHERE a.meeting_id = m.id) AS responded
           FROM meetings m WHERE m.session_id = ? ORDER BY m.start_utc DESC, m.created_at DESC`,
        )
        .bind(sid),
    ]);
    const payload: SessionPayload = {
      session,
      participants: participants.results as unknown as Participant[],
      meetings: (meetings.results as unknown as (MeetingRow & { responded: number })[]).map(
        (r): MeetingSummary => ({ ...toMeeting(r), responded: r.responded }),
      ),
    };
    return json(payload);
  }

  // POST /api/s/:sid/participants
  if (rest.length === 1 && rest[0] === "participants" && method === "POST") {
    await requireSession(db, sid);
    const input = await body<{ initials?: unknown; tz?: unknown }>(request);
    const initials = typeof input.initials === "string" ? input.initials.trim().toUpperCase() : "";
    if (!INITIALS_RE.test(initials)) throw new HttpError(400, "Initials must be 1-4 letters or digits");
    const tz = cleanTz(input.tz);
    const existing = await db
      .prepare("SELECT id FROM participants WHERE session_id = ? AND initials = ?")
      .bind(sid, initials)
      .first();
    if (existing) throw new HttpError(409, `Someone has already joined as ${initials}`);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM participants WHERE session_id = ?")
      .bind(sid)
      .first<number>("n");
    const participant: Participant = { id: randomId(10), initials, tz, color: count ?? 0 };
    await db
      .prepare("INSERT INTO participants (id, session_id, initials, tz, color, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(participant.id, sid, initials, tz, participant.color, Date.now())
      .run();
    return json(participant, 201);
  }

  // PATCH /api/s/:sid/participants/:pid  (time zone change, e.g. travelling)
  if (rest.length === 2 && rest[0] === "participants" && method === "PATCH") {
    const participant = await requireParticipant(db, sid, rest[1]);
    const { tz } = await body<{ tz?: unknown }>(request);
    participant.tz = cleanTz(tz);
    await db.prepare("UPDATE participants SET tz = ? WHERE id = ?").bind(participant.tz, participant.id).run();
    return json(participant);
  }

  // POST /api/s/:sid/meetings
  if (rest.length === 1 && rest[0] === "meetings" && method === "POST") {
    await requireSession(db, sid);
    const input = await body<Record<string, unknown>>(request);
    const title = cleanText(input.title, "title", 120);
    const tz = cleanTz(input.tz);
    const slotMinutes = Number(input.slotMinutes);
    if (!SLOT_OPTIONS.includes(slotMinutes as (typeof SLOT_OPTIONS)[number])) {
      throw new HttpError(400, "slotMinutes must be 15, 30 or 60");
    }
    const startUtc = Number(input.startUtc);
    const endUtc = Number(input.endUtc);
    const slotMs = slotMinutes * 60_000;
    if (!Number.isInteger(startUtc) || !Number.isInteger(endUtc) || endUtc <= startUtc) {
      throw new HttpError(400, "Invalid date range");
    }
    // Local midnight falls on a UTC quarter hour in every real time zone.
    if (startUtc % (15 * 60_000) !== 0) throw new HttpError(400, "Range must start on a quarter hour");
    if ((endUtc - startUtc) % slotMs !== 0) throw new HttpError(400, "Range must be a whole number of slots");
    if (endUtc - startUtc > (MAX_DAYS + 1) * 86_400_000) {
      throw new HttpError(400, `A meeting can cover at most ${MAX_DAYS} days`);
    }
    const createdBy = typeof input.createdBy === "string" ? input.createdBy : null;
    const meeting: Meeting = {
      id: randomId(8),
      title,
      startUtc,
      endUtc,
      slotMinutes,
      tz,
      createdBy,
      chosenStart: null,
      chosenEnd: null,
      createdAt: Date.now(),
    };
    await db
      .prepare(
        `INSERT INTO meetings (id, session_id, title, start_utc, end_utc, slot_minutes, tz, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(meeting.id, sid, title, startUtc, endUtc, slotMinutes, tz, createdBy, meeting.createdAt)
      .run();
    return json(meeting, 201);
  }

  if (rest[0] !== "m" || !rest[1]) throw new HttpError(404, "Not found");
  const mid = rest[1];
  const tail = rest.slice(2);

  // GET /api/s/:sid/m/:mid
  if (tail.length === 0 && method === "GET") {
    const session = await requireSession(db, sid);
    const meeting = await requireMeeting(db, sid, mid);
    const [participants, rows] = await db.batch([
      db
        .prepare("SELECT id, initials, tz, color FROM participants WHERE session_id = ? ORDER BY created_at")
        .bind(sid),
      db.prepare("SELECT participant_id, slots FROM availability WHERE meeting_id = ?").bind(mid),
    ]);
    const availability: Record<string, number[]> = {};
    for (const r of rows.results as { participant_id: string; slots: string }[]) {
      availability[r.participant_id] = JSON.parse(r.slots);
    }
    const payload: MeetingPayload = {
      session,
      participants: participants.results as unknown as Participant[],
      meeting,
      availability,
    };
    return json(payload);
  }

  // PATCH /api/s/:sid/m/:mid  { title?, chosenStart?, chosenEnd? }
  if (tail.length === 0 && method === "PATCH") {
    const meeting = await requireMeeting(db, sid, mid);
    const input = await body<Record<string, unknown>>(request);
    if ("title" in input) meeting.title = cleanText(input.title, "title", 120);
    if ("chosenStart" in input) {
      if (input.chosenStart === null) {
        meeting.chosenStart = null;
        meeting.chosenEnd = null;
      } else {
        const s = Number(input.chosenStart);
        const e = Number(input.chosenEnd);
        if (!Number.isInteger(s) || !Number.isInteger(e) || e <= s) throw new HttpError(400, "Invalid chosen time");
        meeting.chosenStart = s;
        meeting.chosenEnd = e;
      }
    }
    await db
      .prepare("UPDATE meetings SET title = ?, chosen_start = ?, chosen_end = ? WHERE id = ?")
      .bind(meeting.title, meeting.chosenStart, meeting.chosenEnd, mid)
      .run();
    return json(meeting);
  }

  // DELETE /api/s/:sid/m/:mid
  if (tail.length === 0 && method === "DELETE") {
    await requireMeeting(db, sid, mid);
    await db.batch([
      db.prepare("DELETE FROM availability WHERE meeting_id = ?").bind(mid),
      db.prepare("DELETE FROM meetings WHERE id = ?").bind(mid),
    ]);
    return json({ ok: true });
  }

  // PUT /api/s/:sid/m/:mid/availability/:pid  { slots: number[] }
  if (tail.length === 2 && tail[0] === "availability" && method === "PUT") {
    const meeting = await requireMeeting(db, sid, mid);
    await requireParticipant(db, sid, tail[1]);
    const { slots } = await body<{ slots?: unknown }>(request);
    if (!Array.isArray(slots)) throw new HttpError(400, "slots must be an array");
    const max = slotCount(meeting);
    const clean = [...new Set(slots.map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 0 && n < max)
      .sort((a, b) => a - b);
    await db
      .prepare(
        `INSERT INTO availability (meeting_id, participant_id, slots, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (meeting_id, participant_id) DO UPDATE SET slots = excluded.slots, updated_at = excluded.updated_at`,
      )
      .bind(mid, tail[1], JSON.stringify(clean), Date.now())
      .run();
    return json({ slots: clean });
  }

  throw new HttpError(404, "Not found");
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  try {
    return await route(ctx);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
};
