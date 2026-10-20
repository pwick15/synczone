import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Participant } from "../../shared/types";
import { INITIALS_RE } from "../../shared/types";
import { api, ApiError } from "../api";
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

/**
 * "Who are you?" — pick someone already in the session, or add yourself as someone new.
 * Shown in every new tab, and from the header's Switch button.
 */
export function PersonPicker({
  sid,
  sessionName,
  participants,
  currentId,
  lastId,
  onPick,
  onAdded,
  onCancel,
}: {
  sid: string;
  sessionName: string;
  participants: Participant[];
  currentId: string | null;
  lastId: string | null;
  onPick: (p: Participant) => void;
  onAdded: (p: Participant) => void;
  /** Present when the picker can be closed without choosing (switching, not first visit). */
  onCancel?: () => void;
}) {
  const [initials, setInitials] = useState("");
  const [tz, setTz] = useState(browserTz);
  const [editTz, setEditTz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!INITIALS_RE.test(clean)) return setError("Use 1–4 letters or numbers.");
    const existing = participants.find((p) => p.initials === clean);
    if (existing) return setError(`${clean} is already here. Tap them above if that's you, or add a letter.`);
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.join(sid, clean, tz));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `${clean} was just added by someone else. Pick a different set of initials.`
          : (err as Error).message,
      );
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className="dialog picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <p className="eyebrow">{sessionName}</p>
        <h2 id="picker-title">Who are you?</h2>

        {participants.length > 0 && (
          <ul className="people">
            {participants.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`person${p.id === currentId ? " current" : ""}${p.id === lastId ? " last" : ""}`}
                  onClick={() => onPick(p)}
                >
                  <Avatar p={p} />
                  <span className="person-info">
                    <strong>{p.initials}</strong>
                    <span className="muted">{tzCity(p.tz)}</span>
                  </span>
                  {p.id === currentId ? (
                    <span className="tag">Current</span>
                  ) : (
                    p.id === lastId && <span className="tag">Last time</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="add-person" onSubmit={add}>
          <label htmlFor="initials">{participants.length ? "Someone new? Add yourself" : "Add yourself to get started"}</label>
          <div className="row">
            <input
              id="initials"
              className="initials-input"
              value={initials}
              onChange={(e) => {
                setError(null);
                setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4));
              }}
              placeholder="Initials"
              autoFocus={participants.length === 0}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <button className="primary" disabled={busy || !initials}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
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
        </form>

        {onCancel && (
          <button type="button" className="ghost picker-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Header control showing who you are in this tab, with a way to switch. */
export function WhoAmI({ me, onSwitch }: { me: Participant; onSwitch: () => void }) {
  return (
    <button className="whoami" onClick={onSwitch} title="Switch person">
      <Avatar p={me} size="sm" />
      <span>
        You're <strong>{me.initials}</strong>
      </span>
      <span className="whoami-switch">Switch</span>
    </button>
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
