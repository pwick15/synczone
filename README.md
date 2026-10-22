# SyncZone

Find meeting times across time zones. Create a session, share its link, and everyone marks when they're free in their own local time. Each session holds any number of meetings, and each meeting tracks its own availability.

- **Sessions** have an unguessable URL (`/s/<id>`). Only people with the link can see them. Anyone with the link can edit or delete the session and its meetings, so treat it like a shared doc link. Deleting can't be undone.
- **Who are you?** Every new tab asks you to pick someone already in the session or add yourself (initials: 1–4 letters or numbers, unique per session; time zone detected). A reload keeps your pick, and whoever you picked last time is highlighted. Use **Switch** in the header to change person or add someone new.
- **Meetings** cover 1–14 days, from midnight in the creator's time zone, in 15, 30, or 60-minute blocks.
- **Status**: a meeting is **Open** until someone locks in a time (then it's **Locked in**) or its last day ends. Once the locked-in time, or the whole window, has passed, it's **Ended** and moves to a Past list. Unlocking reopens it. The session page flags meetings that are waiting on you. Times that have already started are faded in the grid and never suggested.
- **Your availability**: drag to paint a rectangle of free time; drag over painted time to clear it. Saves automatically.
- **Overlap highlight**: the main part of each day column fills in solid when everyone who has answered (you included) is free, with a striped ±30 min buffer (adjustable). Each person's own times are a thin lane in their color down the left edge, yours first. With no common time, it highlights where the most people overlap. Hover or tap a time to see who's free.
- **Best times**: ranked windows for a chosen meeting length where at least two people overlap, shown in your time with everyone else's underneath. Click one to pick a start time, lock it in for everyone, or download a calendar invite (.ics).

Times are stored in UTC and shown in each viewer's zone, so daylight-saving changes are handled. Pages refresh every 10–15 seconds while the tab is visible.

## Stack

- Static React app built with Vite (`src/`)
- Cloudflare Pages Functions for the API (`functions/api/[[path]].ts`)
- Cloudflare D1 (SQLite) for storage (`migrations/`)

All of it fits in Cloudflare's free tier. Functions share the Workers free quota of 100,000 requests a day. A small team leaving tabs open all day uses a fraction of that, and polling pauses in background tabs.

## Run locally

```bash
npm install
npm run db:migrate:local
npm run preview
```

Open http://localhost:8788. That builds the app once and serves it with the API and a local database in `.wrangler/`.

For live reload while editing the frontend, run `npm run dev:api` in one terminal (after one `npm run build`) and `npm run dev` in another, then open the Vite URL. The API runs from `functions/`, so restart `dev:api` after changing it.

## Deploy to Cloudflare Pages

One-time setup:

```bash
npx wrangler login
npx wrangler d1 create sync-zone
```

Copy the `database_id` it prints into `wrangler.toml`, replacing the zeros. Then create the tables in the real database:

```bash
npm run db:migrate:remote
```

Deploy (this also creates the Pages project on the first run):

```bash
npm run deploy
```

Wrangler prints your `https://<project>.pages.dev` URL. Run `npm run deploy` again after any change. If you add a migration later, run `npm run db:migrate:remote` before deploying.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sessions` | Create a session `{ name }` |
| GET | `/api/s/:sid` | Session, participants, meetings |
| DELETE | `/api/s/:sid` | Delete a session and everything in it |
| POST | `/api/s/:sid/participants` | Join `{ initials, tz }` |
| PATCH | `/api/s/:sid/participants/:pid` | Change time zone `{ tz }` |
| POST | `/api/s/:sid/meetings` | Create a meeting `{ title, startUtc, endUtc, slotMinutes, tz }` |
| GET | `/api/s/:sid/m/:mid` | Meeting with everyone's availability |
| PATCH | `/api/s/:sid/m/:mid` | Rename or lock in a time `{ title?, chosenStart?, chosenEnd? }` |
| DELETE | `/api/s/:sid/m/:mid` | Delete a meeting |
| PUT | `/api/s/:sid/m/:mid/availability/:pid` | Replace someone's free slots `{ slots: number[] }` |

A slot index `i` starts at `startUtc + i × slotMinutes`.
