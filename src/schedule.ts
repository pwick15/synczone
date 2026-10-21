import type { Meeting, Participant } from "../shared/types";
import { zoned } from "./time";

export const slotMs = (m: Meeting) => m.slotMinutes * 60_000;
export const slotCount = (m: Meeting) => Math.round((m.endUtc - m.startUtc) / slotMs(m));
export const slotStart = (m: Meeting, i: number) => m.startUtc + i * slotMs(m);

export interface GridModel {
  /** Column keys, "YYYY-MM-DD" in the viewing zone. */
  dates: string[];
  /** Row keys, minute of day in the viewing zone. */
  minutes: number[];
  /** Slot index at (column, row), or undefined when that wall-clock time is outside the meeting. */
  at: (di: number, ri: number) => number | undefined;
}

export type ZonedSlot = { dateKey: string; minute: number };

/** Each slot's wall-clock date and minute of day in `tz`. */
export const zonedSlots = (meeting: Meeting, tz: string): ZonedSlot[] =>
  Array.from({ length: slotCount(meeting) }, (_, i) => zoned(slotStart(meeting, i), tz));

export const NIGHT_END = 6 * 60;

/**
 * Lays the meeting's UTC slots out as a days-by-times grid in the viewing zone.
 * Columns at the edges are partial when the viewer's zone differs from the creator's.
 * On a DST fall-back day the repeated hour keeps its first occurrence.
 */
export function buildGrid(slots: ZonedSlot[], hideNight: boolean): GridModel {
  const cells = new Map<string, number>();
  const dates: string[] = [];
  const minuteSet = new Set<number>();
  slots.forEach(({ dateKey, minute }, i) => {
    if (dates[dates.length - 1] !== dateKey) dates.push(dateKey);
    minuteSet.add(minute);
    const key = `${dateKey}|${minute}`;
    if (!cells.has(key)) cells.set(key, i);
  });
  let minutes = [...minuteSet].sort((a, b) => a - b);
  if (hideNight) minutes = minutes.filter((m) => m >= NIGHT_END);
  return {
    dates,
    minutes,
    at: (di, ri) => cells.get(`${dates[di]}|${minutes[ri]}`),
  };
}

/** Per-slot highlight for the grid: 0 nothing, 1 buffer around the overlap, 2 the overlap itself. */
export type OverlapLevels = Uint8Array;

export interface Overlap {
  levels: OverlapLevels;
  /** Everyone who has answered, including the viewer once they have. */
  people: Participant[];
  /** How many of `people` are free in the highlighted overlap. Equals people.length for a true intersection. */
  together: number;
}

/**
 * Where everyone who has answered is free at once, padded by `bufferMinutes` on each side.
 * With no time that works for all of them, falls back to the slots where the most of them
 * overlap (at least two). A single person on their own is never an overlap.
 */
export function commonOverlap(
  meeting: Meeting,
  people: Participant[],
  availability: Record<string, number[]>,
  bufferMinutes: number,
): Overlap {
  const n = slotCount(meeting);
  const levels = new Uint8Array(n);
  if (people.length < 2) return { levels, people, together: people.length };

  const counts = new Uint16Array(n);
  for (const p of people) for (const i of availability[p.id] ?? []) if (i < n) counts[i]++;
  let together = people.length;
  if (!counts.includes(together)) {
    together = Math.max(0, ...counts);
    if (together < 2) return { levels, people, together };
  }

  for (let i = 0; i < n; i++) if (counts[i] === together) levels[i] = 2;
  const pad = Math.ceil(bufferMinutes / meeting.slotMinutes);
  if (pad > 0) {
    for (let i = 0; i < n; i++) {
      if (levels[i] !== 2) continue;
      for (let j = Math.max(0, i - pad); j <= Math.min(n - 1, i + pad); j++) if (!levels[j]) levels[j] = 1;
    }
  }
  return { levels, people, together };
}

export interface Suggestion {
  /** Slot index where the shared free span begins. */
  start: number;
  /** Exclusive end slot of the shared free span. */
  end: number;
  free: Participant[];
}

/**
 * Finds spans long enough for a meeting of `lengthSlots`, ranked by how many people
 * can make all of it, then by how long the span is, then by how early it is.
 */
export function suggest(
  meeting: Meeting,
  respondents: Participant[],
  availability: Record<string, number[]>,
  lengthSlots: number,
  limit = 6,
): Suggestion[] {
  const n = slotCount(meeting);
  if (!respondents.length || lengthSlots > n) return [];
  const free = respondents.map((p) => {
    const row = new Uint8Array(n);
    for (const i of availability[p.id] ?? []) if (i < n) row[i] = 1;
    return row;
  });
  // run[p][i] = consecutive free slots for person p starting at slot i.
  const runs = free.map((row) => {
    const run = new Uint16Array(n + 1);
    for (let i = n - 1; i >= 0; i--) run[i] = row[i] ? run[i + 1] + 1 : 0;
    return run;
  });

  const spans: { start: number; lastStart: number; who: number[] }[] = [];
  let current: (typeof spans)[number] | null = null;
  for (let i = 0; i + lengthSlots <= n; i++) {
    const who: number[] = [];
    for (let p = 0; p < runs.length; p++) if (runs[p][i] >= lengthSlots) who.push(p);
    const same = current && current.lastStart === i - 1 && current.who.join() === who.join();
    if (same) current!.lastStart = i;
    else {
      current = who.length ? { start: i, lastStart: i, who } : null;
      if (current) spans.push(current);
    }
  }

  const ranked = spans
    .map((s) => ({ start: s.start, end: s.lastStart + lengthSlots, who: s.who }))
    .sort((a, b) => b.who.length - a.who.length || b.end - b.start - (a.end - a.start) || a.start - b.start);

  // Drop spans that overlap a better one which already includes the same people.
  const kept: typeof ranked = [];
  for (const s of ranked) {
    const shadowed = kept.some((k) => k.start < s.end && s.start < k.end && s.who.every((p) => k.who.includes(p)));
    if (!shadowed) kept.push(s);
    if (kept.length === limit) break;
  }
  return kept.map((s) => ({ start: s.start, end: s.end, free: s.who.map((p) => respondents[p]) }));
}

/** A minimal iCalendar file for one meeting time. */
export function icsFor(meeting: Meeting, start: number, end: number, url: string): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SyncZone//EN",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@synczone`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(meeting.title)}`,
    `DESCRIPTION:${esc(`Scheduled with SyncZone: ${url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
