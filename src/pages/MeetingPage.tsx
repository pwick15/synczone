import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meeting, Participant } from "../../shared/types";
import { api, ApiError } from "../api";
import { Grid } from "../components/Grid";
import { Avatar, PersonPicker, WhoAmI } from "../components/People";
import { Link, navigate } from "../router";
import {
  buildGrid,
  icsFor,
  NIGHT_END,
  othersOverlap,
  slotCount,
  slotMs,
  slotStart,
  suggest,
  zonedSlots,
  type Shade,
  type Suggestion,
} from "../schedule";
import { getLastMe, getPref, rememberSession, setPref } from "../storage";
import { browserTz, fmtDay, fmtDuration, fmtRange, fmtTime, tzCity, tzOffset } from "../time";
import { useMe } from "../useMe";
import { usePoll } from "../usePoll";
import { CopyLink, Loading, NotFound } from "./SessionPage";

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

  const bufferOptions = [0, 15, 30, 45, 60].filter((m) => m % meeting.slotMinutes === 0);
  const buffer = bufferOptions.includes(bufferPref) ? bufferPref : (bufferOptions.find((m) => m >= bufferPref) ?? 0);
  const others = respondents.filter((p) => p.id !== me?.id);
  const shade = othersOverlap(meeting, others, availability, buffer);

  const lengthOptions = [15, 30, 45, 60, 90, 120, 180].filter((m) => m % meeting.slotMinutes === 0);
  const length = lengthOptions.includes(lengthMin) ? lengthMin : (lengthOptions.find((m) => m >= lengthMin) ?? meeting.slotMinutes);
  const lengthSlots = length / meeting.slotMinutes;
  const suggestions = suggest(meeting, respondents, availability, lengthSlots);

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
          <p className="muted">
            {fmtDay(meeting.startUtc, tz)} – {fmtDay(meeting.endUtc - 1, tz)} · {meeting.slotMinutes}-minute blocks ·{" "}
            {respondents.length} of {participants.length} responded
          </p>
          {waiting.length > 0 && (
            <p className="waiting">
              <span className="muted">Waiting on</span>
              {waiting.map((p) => (
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

      {chosenSlots && <ChosenBanner meeting={meeting} zones={zones} participants={participants} onUnlock={unlock} />}

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
            shade={shade}
            respondents={respondents}
            availability={availability}
            me={me}
          />
          <div className="legend">
            <span className="swatch-item">
              <span className="swatch swatch-mine" /> You're free
            </span>
            <span className="swatch-item">
              <span className="swatch swatch-overlap" /> {shade.together === shade.others.length ? "Works for everyone else" : `Best overlap (${shade.together} of ${shade.others.length})`}
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
          </div>
          {me && mine ? (
            <>
              <Grid
                model={grid}
                selected={mine}
                onChange={editMine}
                shade={shade.levels}
                chosen={chosenSlots}
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
          {respondents.length === 0 ? (
            <p className="muted">Suggestions appear once people mark their availability.</p>
          ) : suggestions.length === 0 ? (
            <p className="muted">No {fmtDuration(length)} stretch works for anyone yet. Try a shorter meeting.</p>
          ) : (
            <ol className="suggestions">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={`${s.start}-${s.end}`}
                  s={s}
                  meeting={meeting}
                  tz={tz}
                  zones={zones}
                  participants={participants}
                  respondents={respondents}
                  waiting={waiting}
                  length={length}
                  onLockIn={() => lockIn(s.start)}
                />
              ))}
            </ol>
          )}
        </section>
      </div>

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

const names = (people: Participant[]) =>
  people.length <= 1
    ? (people[0]?.initials ?? "")
    : `${people.slice(0, -1).map((p) => p.initials).join(", ")} and ${people[people.length - 1].initials}`;

/** Who's free under the pointer, or what the shading means when nothing is hovered. */
function Readout(props: {
  meeting: Meeting;
  slot: number | null;
  tz: string;
  shade: Shade;
  respondents: Participant[];
  availability: Record<string, number[]>;
  me: Participant | null;
}) {
  const { meeting, slot, tz, shade, respondents, availability, me } = props;
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

  const { others, together } = shade;
  let text: string;
  if (others.length === 0) {
    text = me
      ? "You're the first to fill this in. Shading appears here as teammates add their times."
      : "Join to add your times.";
  } else if (together === others.length) {
    text =
      others.length === 1
        ? `Shaded: when ${names(others)} is free. Paint over it if you can make it.`
        : `Shaded: when ${names(others)} are all free. Paint over it if you can make it.`;
  } else if (others.length === 1) {
    text = `${names(others)} isn't free at any of these times.`;
  } else if (together >= 2) {
    text = `No time works for all of ${names(others)} yet. Shaded where ${together} of them overlap.`;
  } else {
    text = `${names(others)} don't overlap anywhere yet. Mark everything you can do.`;
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
              <span className="zone-name">
                {tzCity(z)}
                {people.length > 0 && <span className="muted"> · {people.map((p) => p.initials).join(", ")}</span>}
              </span>
              <span>{fmtRange(start, end, z, false)}</span>
            </li>
          );
        })}
    </ul>
  );
}

function SuggestionRow(props: {
  s: Suggestion;
  meeting: Meeting;
  tz: string;
  zones: string[];
  participants: Participant[];
  respondents: Participant[];
  waiting: Participant[];
  length: number;
  onLockIn: () => void;
}) {
  const { s, meeting, tz, zones, participants, respondents, waiting } = props;
  const start = slotStart(meeting, s.start);
  const end = slotStart(meeting, s.end);
  const spanMinutes = (s.end - s.start) * meeting.slotMinutes;
  const missing = respondents.filter((p) => !s.free.includes(p));
  const everyone = missing.length === 0;
  return (
    <li className={`suggestion${everyone ? " everyone" : ""}`}>
      <div className="suggestion-main">
        <span className="suggestion-time">{fmtRange(start, end, tz)}</span>
        <span className={`badge${everyone ? " ok" : ""}`}>
          {everyone ? (waiting.length ? "Everyone who answered" : "Everyone") : `${s.free.length} of ${respondents.length}`}
        </span>
        {spanMinutes > props.length && <span className="muted small">{fmtDuration(spanMinutes)} window</span>}
      </div>
      <div className="who">
        {s.free.map((p) => (
          <Avatar key={p.id} p={p} size="sm" />
        ))}
        {missing.map((p) => (
          <Avatar key={p.id} p={p} size="sm" dim />
        ))}
      </div>
      <ZoneLines start={start} end={end} zones={zones} participants={participants} skip={tz} />
      <button className="secondary small" onClick={props.onLockIn}>
        Lock in {fmtDuration(props.length)} at {fmtTime(start, tz)}
      </button>
    </li>
  );
}

function ChosenBanner({
  meeting,
  zones,
  participants,
  onUnlock,
}: {
  meeting: Meeting;
  zones: string[];
  participants: Participant[];
  onUnlock: () => void;
}) {
  const download = () => {
    const blob = new Blob([icsFor(meeting, location.href)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meeting.title.replace(/[^\w -]/g, "").trim() || "meeting"}.ics`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section className="chosen">
      <div>
        <p className="eyebrow">Locked in</p>
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

