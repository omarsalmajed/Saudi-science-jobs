# Owner setup checklist

Do not paste API keys into Claude chat or commit them to files. Everything in
this checklist is a step only you can do — an account, a secret, or a
one-time confirmation.

## 1. Supabase

- [ ] Create a new Supabase project.
- [ ] SQL editor → paste and run `automation/schema.sql` in full.
- [ ] Authentication → Users → create your own login (email + password).
- [ ] SQL editor → run, with your real address:
      ```sql
      insert into public.admins (email) values ('you@example.com');
      ```
- [ ] Settings → API → note the **Project URL**, **anon public** key, and
      **service_role** key. The service key is as powerful as direct database
      access — never put it in `NEXT_PUBLIC_*`, never commit it.

## 2. Website hosting (Vercel, Netlify, or any Next.js host)

Environment variables (see `.env.example`):

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_KEY`

Deploy. `/` should load with no "لم يتم ربط قاعدة البيانات بعد" notice, and
`/admin` should show a login form rather than "غير مهيأ".

## 3. Anthropic

- [ ] Create an API key at console.anthropic.com and enable billing.
- [ ] A 30-day backfill runs a few thousand model calls across two channels
      (triage on every post, extraction only on survivors) — confirm your
      spend limit covers that before the first backfill.

## 4. GitHub Actions

Repo → Settings → Secrets and variables → Actions.

Variables:
- [ ] `FEED_CHANNELS` = `cd4cd,sharqiahjobs`
- [ ] `SUPABASE_URL` = your project URL
- [ ] `JOB_STATUS` = `pending` *(keep this as `pending` until step 5 is done —
      it decides where newly accepted jobs land)*

Secrets:
- [ ] `ANTHROPIC_API_KEY`
- [ ] `SUPABASE_SERVICE_KEY`

The workflow file is already at `.github/workflows/poll.yml` — nothing to
create, GitHub picks it up once the repo is pushed.

## 5. First run

- [ ] Actions tab → **Poll Telegram channels** → **Run workflow**.
- [ ] Mode `dryrun` first, with default settings — read the summary at the
      bottom of the run log. It prints every keep/reject decision and writes
      nothing, so you can sanity-check the classifier's accuracy on your two
      channels before anything touches the database.
- [ ] Mode `backfill`, `days` = 30, status `pending`. This is the real
      first population of the board — expect on the order of a thousand
      posts scanned across both channels, most rejected as non-science.
- [ ] Review the queue: `/admin` → قيد المراجعة (or the fastest path — run the
      **republish** mode once you've spot-checked a sample and are comfortable
      trusting the classifier's calls).
- [ ] Once satisfied, either flip the `JOB_STATUS` variable to `published`
      for future runs, or keep it on `pending` permanently and republish in
      batches — both are supported.

## Notes

- Telegram channels must be public with web preview enabled (`t.me/s/<name>`
  reachable in a logged-out browser). No bot token is used or needed.
- The scheduled run (`poll`, every 30 min) only looks at posts newer than
  each channel's saved cursor, so it stays cheap indefinitely — the backfill
  cost above is a one-time thing per channel.
- If you ever need to re-scan a channel from scratch, delete its row from
  the `meta` table (`channel_cursor_<name>`) and run `backfill` again; the
  duplicate-prevention indexes make this safe even if some of those posts
  were already imported.
