# Saudi Science Jobs

An Arabic RTL job board for science vacancies in Saudi Arabia. Two public
Telegram channels are polled every 30 minutes, an LLM filters and extracts
the genuine science-related vacancies, and the site publishes them for 30
days. Employers can also submit directly; those go to a review queue.

## Architecture

```
Telegram (public channels)
        │  t.me/s/<channel> — no bot token needed
        ▼
automation/run.js  ── GitHub Actions, every 30 min ──►  Supabase (jobs, meta, admins)
        │  Claude Haiku triage → Claude Sonnet extraction → OCR for image-only posts
        ▼
Next.js site  ── reads with the anon key, RLS-limited to published + <30 days ──►  visitor
        │
        └─ /submit → /api/submit → Supabase (service key, status='pending')
        └─ /admin  → signed-in allowlisted user, session client under RLS
```

Three separate Supabase credentials, three separate trust levels:

| Client | Key | Where it runs | What it can do |
|---|---|---|---|
| `publicClient()` | anon | public page (server-rendered) | read published, non-expired jobs — nothing else, enforced by RLS |
| `sessionClient()` | anon + visitor cookie | `/admin` | whatever the signed-in user's row in `admins` allows, still under RLS |
| `serviceClient()` | service-role | `/api/submit`, the poller, admin stats | bypasses RLS — server-only, never sent to a browser |

## What's included

- Public board: Arabic RTL, specialty/city filters, search, 30-day auto-expiry
- Employer submission form → `/api/submit` → review queue (rate-limited, honeypot, validated)
- Admin dashboard: publish/hide/delete, inline field editing, manual add, channel/stats view — gated on a Supabase Auth + `admins` table allowlist
- Telegram reader (`automation/channel.js`) — no bot token, reads the public `t.me/s/` preview
- Two-stage classification: a cheap model triages every post, a stronger model extracts fields only from what survives — keeps a 1,000-post backfill affordable
- Vision OCR for image-only posts (screenshots of a hiring poster with a thin caption)
- Four independent duplicate signals (source post, application URL, contact+title, employer/title/city/day) enforced by Postgres unique indexes, not just app logic
- Per-channel polling cursors, so a re-run never re-processes old posts
- 63 automated tests (`npm test` in both `/` and `automation/`)

## Deploy

**1. Supabase**
- New project → SQL editor → run `automation/schema.sql`
- Create your login under Authentication → Users
- `insert into public.admins (email) values ('you@example.com');`

**2. Website** (Vercel, Netlify, or any Next.js host)
- Env vars from `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- `npm install && npm run build`

**3. Automation** (GitHub Actions)
- Repo variables: `FEED_CHANNELS=cd4cd,sharqiahjobs`, `SUPABASE_URL`, `JOB_STATUS=pending`
- Repo secrets: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`
- The workflow lives at `.github/workflows/poll.yml` and needs no further setup — GitHub picks it up automatically once the file is in the repo.

Full first-run sequence: **`SETUP_CHECKLIST.md`**.

## Running the poller by hand

From the **Actions** tab → **Poll Telegram channels** → **Run workflow**:

| mode | does |
|---|---|
| `poll` | only posts newer than each channel's saved cursor — the cron |
| `backfill` | walks back `days` of history (default 30), bounded by date not page count |
| `republish` | bulk-promotes queued Telegram jobs (`pending` → `published`); employer submissions are left for manual review |
| `dryrun` | runs the full pipeline and prints every keep/reject decision — writes nothing |

Or locally, with `.env` exported: `cd automation && npm install && npm run poll` /
`npm run backfill` / `npm run dryrun`.

## Maintenance

- **Cursors & channel health** — Admin → الاستيراد tab shows each channel's last seen post and when it last moved.
- **Adding a channel** — add it to `FEED_CHANNELS` (comma-separated); the poller creates its cursor on first run.
- **Expiry** — every run flips `published` jobs older than 30 days to `expired`. They stay in the database (for audit/dedup) but drop off the public feed.
- **Deleting vs. expiring** — admin delete is a soft `status='deleted'`, not a row delete, so a listing can be safely re-added later if it was removed by mistake.

## Tests

```
npx tsc --noEmit && npx eslint . && npx next build   # website
cd automation && npm test                             # 41 unit tests (contact
                                                        # extraction, dedup, Arabic
                                                        # normalisation, HTML parsing)
                                                        # + 22 schema/RLS assertions
                                                        # against a real Postgres (PGlite)
```

## Not included on purpose

API keys and Supabase credentials — see `.env.example` and `SETUP_CHECKLIST.md`.
