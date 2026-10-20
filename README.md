# SyncZone

Find meeting times across time zones. Create a session, share its link, and everyone marks when they're free in their own local time. Each session holds any number of meetings, and each meeting tracks its own availability.

- **Sessions** have an unguessable URL (`/s/<id>`). Only people with the link can see them. Anyone with the link can edit or delete the session and its meetings, so treat it like a shared doc link. Deleting can't be undone.
- **Joining** asks for initials (1–4 letters or numbers, unique per session) and detects your time zone. The browser remembers who you are. On a new device, pick your initials from the list instead of typing them again.
- **Meetings** cover 1–14 days, from midnight in the creator's time zone, in 15, 30, or 60-minute blocks.
- **Your availability**: drag to paint a rectangle of free time; drag over painted time to clear it. Saves automatically.
- **Overlap shading**: behind your own painting, the grid shades where everyone else overlaps, plus a ±30 min buffer (adjustable). With no common time, it shades where the most people overlap. Hover or tap a time to see who's free.
- **Best times**: ranked windows for a chosen meeting length, each shown in every teammate's time zone. Lock one in, and everyone sees it with an "Add to calendar" (.ics) button.

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
