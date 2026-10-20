import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Link, navigate } from "../router";
import { forgetSession, recentSessions, rememberSession } from "../storage";

export function Home() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(recentSessions);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createSession(name.trim());
      rememberSession(id, name.trim());
      navigate(`/s/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page home">
      <section className="hero">
        <h1>Find a time that works in every time zone.</h1>
        <p className="lede">
          Make a session for your team, share the link, and everyone marks when they're free in their own local time.
          SyncZone shows where it overlaps.
        </p>
        <form className="create" onSubmit={create}>
          <label htmlFor="session-name">Team or project name</label>
          <div className="row">
            <input
              id="session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Capstone team"
              maxLength={80}
              autoFocus
            />
            <button className="primary" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create session"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <ol className="steps">
        <li>
          <strong>Share one link.</strong> Each session has its own private URL. Only people with it can see your team.
        </li>
        <li>
          <strong>Add a meeting.</strong> Pick the next few days. Each meeting tracks its own availability.
        </li>
        <li>
          <strong>Paint your free time.</strong> Times show in each person's own zone, and the best overlaps rise to
          the top.
        </li>
      </ol>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Your sessions</h2>
          <ul className="list">
            {recent.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`}>{s.name}</Link>
                <button
                  className="ghost small"
                  aria-label={`Remove ${s.name} from this list`}
                  onClick={() => {
                    forgetSession(s.id);
                    setRecent(recentSessions());
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Listed from this browser only. Removing one here doesn't delete it.</p>
        </section>
      )}
    </main>
  );
}
