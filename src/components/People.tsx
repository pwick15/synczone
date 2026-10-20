import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Participant } from "../../shared/types";
import { INITIALS_RE } from "../../shared/types";
import { api, ApiError } from "../api";
import { setMe } from "../storage";
import { allTimeZones, browserTz, fmtTime, tzCity, tzLabel, tzOffset } from "../time";

export function Avatar({ p, size = "md", dim }: { p: Participant; size?: "sm" | "md"; dim?: boolean }) {
  return (
    <span className={`avatar avatar-${size} c${p.color % 8}${dim ? " dim" : ""}`} title={`${p.initials} · ${tzLabel(p.tz)}`}>
      {p.initials}
    </span>
  );
}

export function TzSelect({ value, onChange, id }: { value: string; onChange: (tz: string) => void; id?: string }) {
  const zones = useMemo(() => {
    const list = allTimeZones();
    return list.includes(value) ? list : [value, ...list];
  }, [value]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")} ({tzOffset(z)})
        </option>
      ))}
    </select>
  );
}

export function JoinDialog({
  sid,
  sessionName,
  participants,
  onJoined,
}: {
  sid: string;
  sessionName: string;
  participants: Participant[];
  onJoined: (p: Participant) => void;
}) {
  const [initials, setInitials] = useState("");
  const [tz, setTz] = useState(browserTz);
  const [editTz, setEditTz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claim = (p: Participant) => {
    setMe(sid, p.id);
    onJoined(p);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!INITIALS_RE.test(clean)) return setError("Use 1–4 letters or numbers.");
    setBusy(true);
    setError(null);
    try {
      claim(await api.join(sid, clean, tz));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `${clean} is already in this session. If that's you, pick it below. Otherwise add a letter.`
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <form className="dialog" onSubmit={submit}>
        <p className="eyebrow">Joining</p>
        <h2>{sessionName}</h2>
        <label htmlFor="initials">Your initials</label>
        <input
          id="initials"
          className="initials-input"
          value={initials}
          onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
          placeholder="e.g. PW"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
        />
        <div className="field-note">
          {editTz ? (
            <TzSelect value={tz} onChange={setTz} />
          ) : (
            <>
              Time zone: <strong>{tzLabel(tz)}</strong>{" "}
              <button type="button" className="link" onClick={() => setEditTz(true)}>
                Change
              </button>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !initials}>
          {busy ? "Joining…" : "Join"}
        </button>
        {participants.length > 0 && (
          <div className="claim">
            <p className="muted">Already joined on another device? Pick yourself:</p>
            <div className="chips">
              {participants.map((p) => (
                <button type="button" key={p.id} className="chip" onClick={() => claim(p)}>
                  <Avatar p={p} size="sm" /> {tzCity(p.tz)}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Everyone in the session with their current local time. */
export function TeamList({
  participants,
  me,
  onChangeTz,
}: {
  participants: Participant[];
  me: Participant | null;
  onChangeTz: (tz: string) => void;
}) {
  const now = useNow();
  const [editing, setEditing] = useState(false);
  return (
    <ul className="team">
      {participants.map((p) => (
        <li key={p.id} className={p.id === me?.id ? "is-me" : undefined}>
          <Avatar p={p} />
          <div className="team-info">
            <strong>
              {p.initials}
              {p.id === me?.id && <span className="you"> (you)</span>}
            </strong>
            {p.id === me?.id && editing ? (
              <TzSelect
                value={p.tz}
                onChange={(tz) => {
                  setEditing(false);
                  onChangeTz(tz);
                }}
              />
            ) : (
              <span className="muted">
                {tzCity(p.tz)} · {tzOffset(p.tz, now)}
                {p.id === me?.id && (
                  <>
                    {" · "}
                    <button className="link" onClick={() => setEditing(true)}>
                      change
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
          <span className="team-time">{fmtTime(now, p.tz)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Offers to update a stored time zone when the browser now reports a different one. */
export function TzDriftNotice({ me, onUpdate }: { me: Participant; onUpdate: (tz: string) => void }) {
  const current = browserTz();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || current === me.tz || tzOffset(current) === tzOffset(me.tz)) return null;
  return (
    <div className="notice">
      <span>
        Your device is on <strong>{tzLabel(current)}</strong>, but you joined as {tzLabel(me.tz)}.
      </span>
      <button onClick={() => onUpdate(current)}>Switch to {tzCity(current)}</button>
      <button className="ghost" onClick={() => setDismissed(true)}>
        Keep
      </button>
    </div>
  );
}
