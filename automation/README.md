# Saudi Science Jobs — automation

The production Telegram poller. Reads public channels every 30 minutes,
classifies posts in two stages (cheap triage, then extraction on survivors),
reads image-only ads with vision OCR, prevents duplicates on four
independent signals, and expires published jobs after 30 days.

This folder is a separate npm package from the website — it runs standalone
in GitHub Actions and shares no build step with `/`.

## Files

| file | role |
|---|---|
| `channel.js` | reads `t.me/s/<channel>` (no bot token), parses posts/photos/links |
| `contacts.js` | pulls phone/email/apply-URL out of a post *before* it reaches the model |
| `dedup.js` | Arabic/URL normalisation and the four duplicate-identity keys |
| `run.js` | orchestration: triage → extract → OCR fallback → insert → cursor → expiry |
| `schema.sql` | the Supabase schema this poller writes to (source of truth) |
| `test/unit.test.mjs` | 41 tests — extraction, normalisation, HTML parsing |
| `test/schema.test.mjs` | 22 tests — applies `schema.sql` to a real Postgres (PGlite) and asserts RLS |

## Included channels

- `cd4cd`
- `sharqiahjobs`

Add more as a comma-separated `FEED_CHANNELS` value. Each channel gets its
own cursor in `meta` (`channel_cursor_<name>`), so channels never interfere
with each other even though post IDs are only unique within a channel.

## Running

```
npm install
npm test          # both suites — no network, no keys needed

# with SUPABASE_URL / SUPABASE_SERVICE_KEY / ANTHROPIC_API_KEY / FEED_CHANNELS exported:
npm run poll       # MODE=poll — only new posts since each cursor
npm run backfill   # MODE=backfill, DAYS=30 by default
npm run dryrun     # full pipeline, prints decisions, writes nothing
```

Full owner setup: `../SETUP_CHECKLIST.md`. Full architecture: `../README.md`.
