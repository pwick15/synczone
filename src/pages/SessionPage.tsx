import { useEffect, useState, type FormEvent } from "react";
import type { MeetingSummary, Participant } from "../../shared/types";
import { MAX_DAYS, SLOT_OPTIONS } from "../../shared/types";
import { api, ApiError } from "../api";
import { JoinDialog, TeamList, TzDriftNotice } from "../components/People";
import { Link, navigate } from "../router";
import { rememberSession } from "../storage";
import { useMe } from "../useMe";
import { usePoll } from "../usePoll";
import { browserTz, fmtDay, fmtRange, todayIn, tzLabel, zonedMidnight } from "../time";

export function SessionPage({ sid }: { sid: string }) {
  const { data, setData, error, refresh } = usePoll(() => api.getSession(sid), 15_000, [sid]);
  const { me, setMeId } = useMe(sid, data?.participants);

  useEffect(() => {
    if (data) rememberSession(sid, data.session.name);
  }, [sid, data?.session.name]);

  if (error instanceof ApiError && error.status === 404) return <NotFound what="session" />;
  if (!data) return <main className="page">{error ? <p className="error">{error.message}</p> : <Loading />}</main>;

  const updateTz = async (tz: string) => {
    if (!me) return;
    const updated = await api.updateTz(sid, me.id, tz);
    setData({ ...data, participants: data.participants.map((p) => (p.id === updated.id ? updated : p)) });
  };

  const onJoined = (p: Participant) => {
    setMeId(p.id);
    if (!data.participants.some((x) => x.id === p.id)) setData({ ...data, participants: [...data.participants, p] });
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <Link href="/">SyncZone</Link> · Session
          </p>
          <h1>{data.session.name}</h1>
        </div>
        <CopyLink />
      </header>

      {me && <TzDriftNotice me={me} onUpdate={updateTz} />}

      <div className="session-layout">
        <section className="card">
          <h2>Meetings</h2>
          {data.meetings.length === 0 ? (
            <p className="muted">No meetings yet. Create one below and pick the days you're looking at.</p>
          ) : (
            <MeetingList sid={sid} meetings={data.meetings} total={data.participants.length} tz={me?.tz ?? browserTz()} />
          )}
          <NewMeeting sid={sid} me={me} onCreated={refresh} />
        </section>

        <aside className="card">
          <h2>Team</h2>
          {data.participants.length === 0 ? (
            <p className="muted">Nobody has joined yet.</p>
          ) : (
            <TeamList participants={data.participants} me={me} onChangeTz={updateTz} />
          )}
        </aside>
      </div>

      {!me && (
        <JoinDialog sid={sid} sessionName={data.session.name} participants={data.participants} onJoined={onJoined} />
      )}
    </main>
  );
}

function MeetingList({ sid, meetings, total, tz }: { sid: string; meetings: MeetingSummary[]; total: number; tz: string }) {
  return (
    <ul className="meetings">
      {meetings.map((m) => (
        <li key={m.id}>
          <Link href={`/s/${sid}/m/${m.id}`} className="meeting-row">
            <span className="meeting-title">{m.title}</span>
            <span className="muted">
              {fmtDay(m.startUtc, tz)} – {fmtDay(m.endUtc - 1, tz)}
            </span>
            {m.chosenStart && m.chosenEnd ? (
              <span className="badge ok">{fmtRange(m.chosenStart, m.chosenEnd, tz)}</span>
            ) : (
              <span className="badge">
                {m.responded}/{total} responded
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DAY_PRESETS = [1, 3, 5, 7];

function NewMeeting({ sid, me, onCreated }: { sid: string; me: Participant | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const tz = me?.tz ?? browserTz();
  const [start, setStart] = useState(() => todayIn(tz));
  const [days, setDays] = useState(5);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="primary new-meeting" onClick={() => setOpen(true)}>
        + New meeting
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const meeting = await api.createMeeting(sid, {
        title: title.trim() || "Team meeting",
        startUtc: zonedMidnight(start, tz),
        endUtc: zonedMidnight(start, tz, days),
        slotMinutes,
        tz,
        createdBy: me?.id ?? null,
      });
      onCreated();
      navigate(`/s/${sid}/m/${meeting.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="new-meeting-form" onSubmit={submit}>
      <h3>New meeting</h3>
      <label htmlFor="m-title">What's it for?</label>
      <input
        id="m-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Sprint planning"
        maxLength={120}
        autoFocus
      />
      <div className="form-grid">
        <div>
          <label htmlFor="m-start">Starting</label>
          <input id="m-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="m-days">Days to look at</label>
          <div className="segmented" role="group" aria-label="Days to look at">
            {DAY_PRESETS.map((d) => (
              <button type="button" key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>
                {d}
              </button>
            ))}
            <input
              id="m-days"
              type="number"
              min={1}
              max={MAX_DAYS}
              value={days}
              onChange={(e) => setDays(Math.min(MAX_DAYS, Math.max(1, Number(e.target.value) || 1)))}
              aria-label="Custom number of days"
            />
          </div>
        </div>
        <div>
          <label htmlFor="m-slot">Time blocks</label>
          <select id="m-slot" value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
            {SLOT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} minutes
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted small">
        Days run midnight to midnight in {tzLabel(tz)}. Teammates elsewhere see the same window in their own time.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create meeting"}
        </button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CopyLink({ path }: { path?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = location.origin + (path ?? location.pathname);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button className="secondary" onClick={copy}>
      {copied ? "Link copied" : "Copy invite link"}
    </button>
  );
}

export const Loading = () => <p className="muted">Loading…</p>;

export function NotFound({ what }: { what: string }) {
  return (
    <main className="page">
      <h1>That {what} doesn't exist</h1>
      <p className="muted">Check the link, or ask whoever shared it to send it again.</p>
      <Link href="/">Go to SyncZone</Link>
    </main>
  );
}
