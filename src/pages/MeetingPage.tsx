import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meeting, Participant } from "../../shared/types";
import { api, ApiError } from "../api";
import { Grid, type Lane } from "../components/Grid";
import { Avatar, PersonPicker, WhoAmI } from "../components/People";
import { Link, navigate } from "../router";
import {
  buildGrid,
  icsFor,
  NIGHT_END,
  commonOverlap,
  firstUpcomingSlot,
  meetingStatus,
  slotCount,
  slotMs,
  slotStart,
  suggest,
  zonedSlots,
  type Overlap,
  type Suggestion,
} from "../schedule";
import { getLastMe, getPref, rememberSession, setPref } from "../storage";
import { browserTz, fmtDay, fmtDuration, fmtRange, fmtTime, tzCity, tzOffset, zoned } from "../time";
import { useMe } from "../useMe";
import { usePoll } from "../usePoll";
import { CopyLink, Loading, NotFound, StatusPill } from "./SessionPage";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function MeetingPage({ sid, mid }: { sid: string; mid: string }) {
  // Remember when each poll started so a response that left before our last save
  // can't overwrite the newer local selection.
  const savedAt = useRef(0);
  const load = useCallback(async () => {
    const startedAt = Date.now();
    const payload = await api.getMeeting(sid, mid);
    return { payload, startedAt };
  }, [sid, mid]);
  const { data, setData, error } = usePoll(load, 10_000, [sid, mid]);
  const payload = data?.payload;
  const { me, choose } = useMe(sid, payload?.participants);
  const [switching, setSwitching] = useState(false);

  const [mine, setMine] = useState<Set<number> | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const dirty = useRef(false);

  useEffect(() => {
    setMine(null);
    dirty.current = false;
  }, [sid, mid, me?.id]);

  useEffect(() => {
    if (!data || !me || dirty.current || data.startedAt < savedAt.current) return;
    setMine(new Set(data.payload.availability[me.id] ?? []));
  }, [data, me]);

  useEffect(() => {
    if (payload) rememberSession(sid, payload.session.name);
  }, [sid, payload?.session.name]);

  // Debounced save of my selection.
  const meId = me?.id;
  useEffect(() => {
    if (!dirty.current || !mine || !meId) return;
    setSave("pending");
    const t = window.setTimeout(async () => {
      setSave("saving");
      try {
        await api.saveAvailability(sid, mid, meId, [...mine]);
        dirty.current = false;
        savedAt.current = Date.now();
        setSave("saved");
      } catch {
        setSave("error");
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [mine, meId, sid, mid]);

  const editMine = (next: Set<number>) => {
    dirty.current = true;
    setMine(next);
  };

  const [viewTz, setViewTz] = useState<string | null>(null);
  const [showNight, setShowNight] = useState(() => getPref("showNight", false));
  const [hover, setHover] = useState<number | null>(null);
  const [lockTarget, setLockTarget] = useState<Suggestion | null>(null);
  const [lengthMin, setLengthMin] = useState(60);
  const [bufferPref, setBufferPref] = useState(() => getPref("buffer", 30));

  const meeting = payload?.meeting;
  const tz = viewTz ?? me?.tz ?? browserTz();
  const zonedList = useMemo(() => (meeting ? zonedSlots(meeting, tz) : []), [meeting, tz]);
  // Overnight rows stay visible whenever someone is free then, so overlaps never hide.
  const nightUsed = useMemo(
    () => Object.values(payload?.availability ?? {}).some((slots) => slots.some((i) => zonedList[i]?.minute < NIGHT_END)),
    [payload, zonedList],
  );
  const grid = useMemo(
    () => (meeting ? buildGrid(zonedList, !showNight && !nightUsed) : null),
    [meeting, zonedList, showNight, nightUsed],
  );

  if (error instanceof ApiError && error.status === 404) {
    return <NotFound what="meeting" back={{ href: `/s/${sid}`, label: "Back to the session" }} />;
  }
  if (!payload || !meeting || !grid) {
    return <main className="page">{error ? <p className="error">{error.message}</p> : <Loading />}</main>;
  }

  const participants = payload.participants;
  // My live selection counts even before it reaches the server.
  const availability: Record<string, number[]> = { ...payload.availability };
  if (me && mine && (dirty.current || me.id in availability)) availability[me.id] = [...mine];
  const respondents = participants.filter((p) => p.id in availability);
  const waiting = participants.filter((p) => !(p.id in availability));

  const n = slotCount(meeting);
  const now = Date.now();
  const status = meetingStatus(meeting, now);
  const upcoming = firstUpcomingSlot(meeting, now);

  const bufferOptions = [0, 15, 30, 45, 60].filter((m) => m % meeting.slotMinutes === 0);
  const buffer = bufferOptions.includes(bufferPref) ? bufferPref : (bufferOptions.find((m) => m >= bufferPref) ?? 0);
  const overlap = commonOverlap(meeting, respondents, availability, buffer);
  // Thin per-person lanes: you first (following your live painting), then everyone who answered.
  const lanes: Lane[] = [];
  if (me) lanes.push({ id: me.id, color: me.color, free: new Uint8Array(0), isMe: true });
  for (const p of respondents) {
    if (p.id === me?.id) continue;
    const free = new Uint8Array(n);
    for (const i of availability[p.id]) if (i < n) free[i] = 1;
    lanes.push({ id: p.id, color: p.color, free, isMe: false });
  }
  const lanePeople = lanes.map((l) => participants.find((p) => p.id === l.id)!);

  const lengthOptions = [15, 30, 45, 60, 90, 120, 180].filter((m) => m % meeting.slotMinutes === 0);
  const length = lengthOptions.includes(lengthMin) ? lengthMin : (lengthOptions.find((m) => m >= lengthMin) ?? meeting.slotMinutes);
  const lengthSlots = length / meeting.slotMinutes;
  // Only offer start times still ahead, and only ones at least two people share.
  const ahead = upcoming
    ? Object.fromEntries(Object.entries(availability).map(([id, slots]) => [id, slots.filter((i) => i >= upcoming)]))
    : availability;
  const suggestions = suggest(meeting, respondents, ahead, lengthSlots).filter((s) => s.free.length >= 2);

  const chosenSlots: [number, number] | null =
    meeting.chosenStart && meeting.chosenEnd
      ? [(meeting.chosenStart - meeting.startUtc) / slotMs(meeting), (meeting.chosenEnd - meeting.startUtc) / slotMs(meeting)]
      : null;

  const zones = [...new Set([me?.tz ?? browserTz(), ...participants.map((p) => p.tz)])];

  const setMeeting = (m: Meeting) => data && setData({ ...data, payload: { ...payload, meeting: m } });

  const lockIn = async (startSlot: number) => {
    const start = slotStart(meeting, startSlot);
    const end = slotStart(meeting, Math.min(n, startSlot + lengthSlots));
    setMeeting(await api.updateMeeting(sid, mid, { chosenStart: start, chosenEnd: end }));
  };

  const unlock = async () => setMeeting(await api.updateMeeting(sid, mid, { chosenStart: null }));

  const remove = async () => {
    if (!window.confirm(`Delete "${meeting.title}" and everyone's availability for it? This can't be undone.`)) return;
    try {
      await api.deleteMeeting(sid, mid);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) return window.alert((err as Error).message);
    }
    navigate(`/s/${sid}`);
  };

  const pick = async (p: Participant) => {
    setSwitching(false);
    if (p.id === me?.id) return;
    if (me && mine) {
      // Save the current person's unsaved painting before switching away from them,
      // and keep it in the local copy so their times show up straight away.
      const wasDirty = dirty.current;
      const slots = [...mine];
      if (wasDirty) {
        try {
          await api.saveAvailability(sid, mid, me.id, slots);
        } catch {
          setSave("error");
          return;
        }
      }
      if (wasDirty || me.id in payload.availability) {
        setData((d) =>
          d ? { ...d, payload: { ...d.payload, availability: { ...d.payload.availability, [me.id]: slots } } } : d,
        );
      }
    }
    dirty.current = false;
    savedAt.current = 0;
    setSave("idle");
    choose(p.id);
  };

  const added = (p: Participant) => {
    if (data && !participants.some((x) => x.id === p.id)) {
      setData({ ...data, payload: { ...payload, participants: [...participants, p] } });
    }
    pick(p);
  };

  return (
    <main className="page wide">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <Link href={`/s/${sid}`}>← {payload.session.name}</Link>
          </p>
          <h1>{meeting.title}</h1>
          <p className="meeting-meta">
            <StatusPill status={status} />
            <span className="muted">
              {fmtDay(meeting.startUtc, tz)} – {fmtDay(meeting.endUtc - 1, tz)} · {meeting.slotMinutes}-minute blocks ·{" "}
              {respondents.length} of {participants.length} responded
            </span>
          </p>
          {status !== "ended" && waiting.length > 0 && (
            <p className="waiting">
              <span className="muted">Waiting on</span>
              {waiting.some((p) => p.id === me?.id) && <strong className="waiting-you">you</strong>}
              {waiting
                .filter((p) => p.id !== me?.id)
                .map((p) => (
                  <Avatar key={p.id} p={p} size="sm" dim />
                ))}
            </p>
          )}
        </div>
        <div className="row">
          {me && <WhoAmI me={me} onSwitch={() => setSwitching(true)} />}
          <CopyLink />
          <button className="ghost danger" onClick={remove}>
            Delete meeting
          </button>
        </div>
      </header>

      {chosenSlots && (
        <ChosenBanner meeting={meeting} ended={status === "ended"} zones={zones} participants={participants} onUnlock={unlock} />
      )}
      {status === "ended" && !chosenSlots && (
        <p className="notice">
          <span>
            These dates have passed and no time was locked in. To find a new time,{" "}
            <Link href={`/s/${sid}`}>create a new meeting</Link> in {payload.session.name}.
          </span>
        </p>
      )}

      <div className="toolbar">
        <label className="inline">
          Show times in
          <select value={tz} onChange={(e) => setViewTz(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {tzCity(z)} ({tzOffset(z)}){z === me?.tz ? " · you" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="inline check" title={nightUsed ? "Shown because someone is free overnight" : undefined}>
          <input
            type="checkbox"
            checked={showNight || nightUsed}
            disabled={nightUsed}
            onChange={(e) => {
              setShowNight(e.target.checked);
              setPref("showNight", e.target.checked);
            }}
          />
          Show midnight–6 AM
        </label>
      </div>

      <div className="meeting-layout">
        <section className="card grid-card">
          <div className="grid-head">
            <h2>Your availability</h2>
            <SaveStatus state={save} />
          </div>
          <p className="muted small">Drag across the times you're free. Drag over them again to clear.</p>
          <Readout
            meeting={meeting}
            slot={hover}
            tz={tz}
            overlap={overlap}
            respondents={respondents}
            availability={availability}
            me={me}
          />
          <div className="legend">
            <span className="swatch-item">
              <span className="swatch swatch-common" />{" "}
              {overlap.together === overlap.people.length
                ? "Everyone's free"
                : `Best overlap (${overlap.together} of ${overlap.people.length})`}
            </span>
            <label className="swatch-item">
              <span className="swatch swatch-buffer" /> Buffer
              <select
                value={buffer}
                onChange={(e) => {
                  setBufferPref(Number(e.target.value));
                  setPref("buffer", Number(e.target.value));
                }}
                aria-label="Buffer around the overlap"
              >
                {bufferOptions.map((m) => (
                  <option key={m} value={m}>
                    {m ? `±${m} min` : "None"}
                  </option>
                ))}
              </select>
            </label>
            {lanePeople.length > 0 && (
              <span className="swatch-item lanes-key">
                Lanes
                {lanePeople.map((p) => (
                  <span key={p.id} className="lane-key">
                    <span className={`lane-swatch c${p.color % 8}${p.id === me?.id ? " me" : ""}`} />
                    {p.id === me?.id ? `${p.initials} (you)` : p.initials}
                  </span>
                ))}
              </span>
            )}
          </div>
          {me && mine ? (
            <>
              <Grid
                model={grid}
                selected={mine}
                onChange={editMine}
                overlap={overlap.levels}
                lanes={lanes}
                chosen={chosenSlots}
                pastBefore={upcoming}
                onHover={setHover}
              />
              {mine.size === 0 && !(me.id in payload.availability) && (
                <button className="ghost small" onClick={() => editMine(new Set())}>
                  None of these times work for me
                </button>
              )}
            </>
          ) : (
            <Loading />
          )}
        </section>

        <section className="card best">
          <div className="grid-head">
            <h2>Best times</h2>
            <label className="inline">
              Length
              <select value={length} onChange={(e) => setLengthMin(Number(e.target.value))}>
                {lengthOptions.map((m) => (
                  <option key={m} value={m}>
                    {fmtDuration(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {upcoming === n ? (
            <p className="muted">All of these times have passed.</p>
          ) : respondents.length < 2 ? (
            <p className="muted">Suggestions appear once two people have marked their availability.</p>
          ) : suggestions.length === 0 ? (
            <p className="muted">
              No upcoming {fmtDuration(length)} stretch works for two or more people yet. Try a shorter meeting.
            </p>
          ) : (
            <ol className="suggestions">
              {suggestions.map((s) => (
                <SuggestionCard
                  key={`${s.start}-${s.end}`}
                  s={s}
                  meeting={meeting}
                  tz={tz}
                  participants={participants}
                  respondents={respondents}
                  waiting={waiting}
                  length={length}
                  onOpen={() => setLockTarget(s)}
                />
              ))}
            </ol>
          )}
        </section>
      </div>

      {lockTarget && (
        <LockDialog
          s={lockTarget}
          meeting={meeting}
          tz={tz}
          zones={zones}
          participants={participants}
          length={length}
          onLock={async (startSlot) => {
            await lockIn(startSlot);
            setLockTarget(null);
          }}
          onClose={() => setLockTarget(null)}
        />
      )}

      {(!me || switching) && (
        <PersonPicker
          sid={sid}
          sessionName={payload.session.name}
          participants={participants}
          currentId={me?.id ?? null}
          lastId={getLastMe(sid)}
          onPick={pick}
          onAdded={added}
          onCancel={me ? () => setSwitching(false) : undefined}
        />
      )}
    </main>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = { idle: "", pending: "Unsaved", saving: "Saving…", saved: "Saved", error: "Couldn't save, retrying on next change" }[state];
  return <span className={`save save-${state}`}>{text}</span>;
}

/** "you, AB and CD", with the viewer first. */
const names = (people: Participant[], me: Participant | null) => {
  const list = [...people]
    .sort((x, y) => Number(y.id === me?.id) - Number(x.id === me?.id))
    .map((p) => (p.id === me?.id ? "you" : p.initials));
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

/** Who's free under the pointer, or what the shading means when nothing is hovered. */
function Readout(props: {
  meeting: Meeting;
  slot: number | null;
  tz: string;
  overlap: Overlap;
  respondents: Participant[];
  availability: Record<string, number[]>;
  me: Participant | null;
}) {
  const { meeting, slot, tz, overlap, respondents, availability, me } = props;
  if (slot !== null) {
    const start = slotStart(meeting, slot);
    const free = respondents.filter((p) => availability[p.id].includes(slot));
    const busy = respondents.filter((p) => !availability[p.id].includes(slot));
    return (
      <div className="readout">
        <strong>{fmtRange(start, start + slotMs(meeting), tz)}</strong>
        <span className="who">
          {free.length > 0 && <span>Free {free.map((p) => <Avatar key={p.id} p={p} size="sm" />)}</span>}
          {busy.length > 0 && <span>Busy {busy.map((p) => <Avatar key={p.id} p={p} size="sm" dim />)}</span>}
          {respondents.length === 0 && <span className="muted">Nobody has answered yet</span>}
        </span>
      </div>
    );
  }

  const { people, together } = overlap;
  const meAnswered = !!me && people.some((p) => p.id === me.id);
  let text: string;
  if (people.length === 0) {
    text = "Nobody has answered yet. Paint your times to get started.";
  } else if (people.length === 1) {
    text = meAnswered
      ? "Only you so far. Shared times light up here once others add theirs."
      : `${people[0].initials} has answered. Paint your times to see where you overlap.`;
  } else if (together === people.length) {
    text = `Highlighted: when ${names(people, me)} are ${people.length === 2 ? "both" : "all"} free.`;
    if (!meAnswered) text += " Paint your times to see if you fit.";
  } else if (together >= 2) {
    text = `No time works for all ${people.length} yet. Highlighted where ${together} of you overlap.`;
  } else {
    text = "Nobody's times overlap yet.";
  }
  return (
    <div className="readout">
      <span className="muted">{text}</span>
    </div>
  );
}

function ZoneLines({
  start,
  end,
  zones,
  participants,
  skip,
}: {
  start: number;
  end: number;
  zones: string[];
  participants: Participant[];
  skip?: string;
}) {
  return (
    <ul className="zones">
      {zones
        .filter((z) => z !== skip)
        .map((z) => {
          const people = participants.filter((p) => p.tz === z);
          return (
            <li key={z}>
              <span>
                {people.length > 0 && <span className="zone-name">{people.map((p) => p.initials).join(", ")} </span>}
                <span className="muted">· {tzCity(z)}</span>
              </span>
              <span>{fmtRange(start, end, z, false)}</span>
            </li>
          );
        })}
    </ul>
  );
}

function downloadIcs(meeting: Meeting, start: number, end: number) {
  const blob = new Blob([icsFor(meeting, start, end, location.href)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${meeting.title.replace(/[^\w -]/g, "").trim() || "meeting"}.ics`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** "9:00 – 10:00", or "23:00 – Wed 1:00" when it runs past midnight. */
function timeSpan(start: number, end: number, tz: string) {
  const sameDay = zoned(start, tz).dateKey === zoned(end - 1, tz).dateKey;
  return sameDay ? `${fmtTime(start, tz)} – ${fmtTime(end, tz)}` : `${fmtTime(start, tz)} – ${fmtDay(end, tz)}, ${fmtTime(end, tz)}`;
}

/** Your time first and large; everyone else's zones underneath, small. The whole card opens the lock-in dialog. */
function SuggestionCard(props: {
  s: Suggestion;
  meeting: Meeting;
  tz: string;
  participants: Participant[];
  respondents: Participant[];
  waiting: Participant[];
  length: number;
  onOpen: () => void;
}) {
  const { s, meeting, tz, participants, respondents, waiting } = props;
  const start = slotStart(meeting, s.start);
  const end = slotStart(meeting, s.end);
  const spanMinutes = (s.end - s.start) * meeting.slotMinutes;
  const missing = respondents.filter((p) => !s.free.includes(p));
  const everyone = missing.length === 0;
  const otherZones = [...new Set(participants.map((p) => p.tz))].filter((z) => z !== tz);
  return (
    <li>
      <button type="button" className={`suggestion${everyone ? " everyone" : ""}`} onClick={props.onOpen}>
        <span className="s-top">
          <span className="s-day">{fmtDay(start, tz)}</span>
          <span className={`badge${everyone ? " ok" : ""}`}>
            {everyone ? (waiting.length ? "Everyone who answered" : "Everyone") : `${s.free.length} of ${respondents.length}`}
          </span>
        </span>
        <span className="s-time">{timeSpan(start, end, tz)}</span>
        <span className="s-label">
          Your time · {tzCity(tz)}
          {spanMinutes > props.length && ` · any ${fmtDuration(props.length)} in this ${fmtDuration(spanMinutes)} window`}
        </span>
        {otherZones.length > 0 && (
          <span className="s-others">
            {otherZones.map((z) => (
              <span key={z} className="s-other">
                <span>
                  <span className="s-who">
                    {participants
                      .filter((p) => p.tz === z)
                      .map((p) => p.initials)
                      .join(", ")}
                  </span>{" "}
                  · {tzCity(z)}
                </span>
                <span>{fmtRange(start, end, z, false)}</span>
              </span>
            ))}
          </span>
        )}
        {!everyone && (
          <span className="s-missing">
            Can't make it {missing.map((p) => <Avatar key={p.id} p={p} size="sm" dim />)}
          </span>
        )}
        <span className="s-cta">Choose this time →</span>
      </button>
    </li>
  );
}

/** Pick a start within the suggested window, then lock it in for everyone or grab a calendar invite. */
function LockDialog(props: {
  s: Suggestion;
  meeting: Meeting;
  tz: string;
  zones: string[];
  participants: Participant[];
  length: number;
  onLock: (startSlot: number) => Promise<void>;
  onClose: () => void;
}) {
  const { s, meeting, tz, zones, participants, length, onClose } = props;
  const lengthSlots = length / meeting.slotMinutes;
  const starts = Array.from({ length: Math.max(1, s.end - s.start - lengthSlots + 1) }, (_, i) => s.start + i);
  const [startSlot, setStartSlot] = useState(s.start);
  const [busy, setBusy] = useState(false);
  const start = slotStart(meeting, startSlot);
  const end = start + length * 60_000;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog lock-dialog" role="dialog" aria-modal="true" aria-labelledby="lock-title">
        <p className="eyebrow">Lock in a time</p>
        <h2 id="lock-title">{meeting.title}</h2>

        {starts.length > 1 && (
          <label className="lock-start">
            Start at
            <select value={startSlot} onChange={(e) => setStartSlot(Number(e.target.value))}>
              {starts.map((i) => (
                <option key={i} value={i}>
                  {fmtTime(slotStart(meeting, i), tz)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="lock-main">
          <span className="s-day">{fmtDay(start, tz)}</span>
          <span className="s-time">{timeSpan(start, end, tz)}</span>
          <span className="s-label">
            Your time · {tzCity(tz)} · {fmtDuration(length)}
          </span>
        </div>
        <ZoneLines start={start} end={end} zones={zones} participants={participants} skip={tz} />

        <p className="muted small">
          Locking it in marks the meeting as decided and shows this time to everyone in the session. You can unlock it
          later.
        </p>
        <div className="row lock-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onLock(startSlot);
              } catch {
                setBusy(false);
              }
            }}
          >
            {busy ? "Locking in…" : "Lock in for everyone"}
          </button>
          <button className="secondary" onClick={() => downloadIcs(meeting, start, end)}>
            Download invite (.ics)
          </button>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ChosenBanner({
  meeting,
  ended,
  zones,
  participants,
  onUnlock,
}: {
  meeting: Meeting;
  ended: boolean;
  zones: string[];
  participants: Participant[];
  onUnlock: () => void;
}) {
  const download = () => downloadIcs(meeting, meeting.chosenStart!, meeting.chosenEnd!);
  return (
    <section className="chosen">
      <div>
        <p className="eyebrow">{ended ? "Locked in · this time has passed" : "Locked in"}</p>
        <ZoneLines start={meeting.chosenStart!} end={meeting.chosenEnd!} zones={zones} participants={participants} />
      </div>
      <div className="row">
        <button className="secondary small" onClick={download}>
          Add to calendar
        </button>
        <button className="ghost small" onClick={onUnlock}>
          Unlock
        </button>
      </div>
    </section>
  );
}

