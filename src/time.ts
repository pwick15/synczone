// Time zone helpers built on Intl, so no tz database ships with the app.

export const browserTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function allTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [browserTz()];
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock date ("YYYY-MM-DD") and minute of day for an instant in a zone. */
export function zoned(ms: number, tz: string): { dateKey: string; minute: number } {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(ms)) p[part.type] = part.value;
  return { dateKey: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function cached(key: string, make: () => Intl.DateTimeFormat) {
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = make()));
  return f;
}

export const fmtTime = (ms: number, tz: string) =>
  cached(`t|${tz}`, () => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" })).format(ms);

export const fmtDay = (ms: number, tz: string) =>
  cached(
    `d|${tz}`,
    () => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }),
  ).format(ms);

const fmtWeekday = (ms: number, tz: string) =>
  cached(`w|${tz}`, () => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short" })).format(ms);

/** Row label for a minute-of-day, in the viewer's locale (e.g. "9 AM" or "09:00"). */
export const fmtMinute = (minute: number) =>
  cached(
    "m",
    () => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }),
  ).format(minute * 60_000);

/** Column header for a "YYYY-MM-DD" key. */
export function fmtDateKey(dateKey: string): { weekday: string; date: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return {
    weekday: cached("hw", () => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short" })).format(ms),
    date: cached("hd", () => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "numeric", month: "short" })).format(ms),
  };
}

/** "Tue 21 Oct, 9:00 – 10:30 AM", spanning days when the range crosses midnight. */
export function fmtRange(start: number, end: number, tz: string, withDay = true): string {
  const sameDay = zoned(start, tz).dateKey === zoned(end - 1, tz).dateKey;
  const s = fmtTime(start, tz);
  const e = fmtTime(end, tz);
  if (!withDay) return sameDay ? `${fmtWeekday(start, tz)} ${s} – ${e}` : `${fmtWeekday(start, tz)} ${s} – ${fmtWeekday(end, tz)} ${e}`;
  return sameDay ? `${fmtDay(start, tz)}, ${s} – ${e}` : `${fmtDay(start, tz)}, ${s} – ${fmtDay(end, tz)}, ${e}`;
}

export const tzCity = (tz: string) => (tz.split("/").pop() ?? tz).replace(/_/g, " ");

export function tzOffset(tz: string, at = Date.now()): string {
  const part = cached(`o|${tz}`, () => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }))
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

export const tzLabel = (tz: string) => `${tzCity(tz)} (${tzOffset(tz)})`;

/** UTC instant of midnight at the start of a "YYYY-MM-DD" date (plus `addDays`) in `tz`. */
export function zonedMidnight(dateValue: string, tz: string, addDays = 0): number {
  const [y, m, d] = dateValue.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d + addDays);
  let t = target;
  // Two passes settle the zone offset, including across a DST change.
  for (let i = 0; i < 2; i++) {
    const z = zoned(t, tz);
    const [zy, zm, zd] = z.dateKey.split("-").map(Number);
    t += target - (Date.UTC(zy, zm - 1, zd) + z.minute * 60_000);
  }
  return t;
}

/** Today as a "YYYY-MM-DD" date input value in `tz`. */
export const todayIn = (tz: string) => zoned(Date.now(), tz).dateKey;

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
