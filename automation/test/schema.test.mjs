/* Applies automation/schema.sql to a real Postgres (PGlite/WASM) and asserts
 * that row level security behaves the way the brief requires.
 *
 * Supabase supplies `anon`, `authenticated`, `service_role` and `auth.jwt()`.
 * PGlite does not, so we recreate just enough of them to exercise the policies.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SCHEMA = new URL("../schema.sql", import.meta.url);
const db = new PGlite();
let pass = 0, fail = 0;

const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

async function asRole(role, email, fn) {
  await db.exec("begin");
  await db.exec(`set local role ${role}`);
  if (email !== null) await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email })]);
  try { return await fn(); }
  finally { await db.exec("rollback"); }
}

/* ---- Supabase shims ---- */
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
`);

/* ---- the real schema ---- */
const sql = readFileSync(SCHEMA, "utf8");
try {
  await db.exec(sql);
  ok("schema.sql applies cleanly", true);
} catch (e) {
  ok("schema.sql applies cleanly", false, `\n        ${e.message}`);
  process.exit(1);
}

/* re-running must be a no-op */
try { await db.exec(sql); ok("schema.sql is idempotent (second run)", true); }
catch (e) { ok("schema.sql is idempotent (second run)", false, e.message); }

/* ---- every field the brief demands exists ---- */
const required = ["source","source_channel","post_id","permalink","posted_at","employer","title",
  "specialty","city","district","employment_type","compensation","gender_pref","saudi_only",
  "needs_scfhs","notes","contact_phone","contact_email","apply_url","from_image","ai_confidence","status"];
const cols = (await db.query(
  `select column_name from information_schema.columns where table_name='jobs'`)).rows.map(r => r.column_name);
const missing = required.filter(c => !cols.includes(c));
ok("all required data fields present", missing.length === 0, missing.join(","));

/* ---- seed rows as the service role ---- */
await db.exec(`insert into public.admins(email) values ('admin@sciencejobs.sa')`);
const seed = async (id, status, ageDays, extra = {}) => {
  const f = { source: "telegram", source_channel: "cd4cd", ...extra };
  await db.query(
    `insert into public.jobs (id,status,source,source_channel,title,city,posted_at,dedup_fingerprint)
     values ($1,$2,$3,$4,$5,$6, now() - ($7 || ' days')::interval, $8)`,
    [id, status, f.source, f.source_channel, f.title ?? "أخصائي مختبر", f.city ?? "الرياض",
     String(ageDays), f.dedup_fingerprint ?? null]);
};
await seed("ch-cd4cd-1", "published", 1);
await seed("ch-cd4cd-2", "published", 40);          // old -> must be invisible
await seed("ch-cd4cd-3", "pending", 1);
await seed("ch-cd4cd-4", "expired", 2);
await seed("ch-cd4cd-5", "deleted", 2);
await db.exec(`insert into public.meta(key,value) values ('channel_cursor_cd4cd','36990')`);

/* ---- anonymous visitor ---- */
await asRole("anon", null, async () => {
  const r = await db.query("select id from public.jobs order by id");
  ok("anon sees only fresh published jobs",
     r.rows.length === 1 && r.rows[0].id === "ch-cd4cd-1",
     `got ${JSON.stringify(r.rows.map(x => x.id))}`);

  const s = await db.query("select id from public.jobs where status='published'");
  ok("anon cannot see the 30-day-old published job", !s.rows.some(x => x.id === "ch-cd4cd-2"));

  let blocked = false;
  try { await db.query(`insert into public.jobs(id,title) values ('x','y')`); }
  catch { blocked = true; }
  ok("anon cannot insert jobs", blocked);

  blocked = false;
  try { await db.query(`update public.jobs set status='published' where id='ch-cd4cd-3'`); }
  catch { blocked = true; }
  ok("anon cannot update jobs", blocked);

  blocked = false;
  try { await db.query("select * from public.meta"); }
  catch { blocked = true; }
  ok("anon cannot read channel cursors", blocked);
});

/* ---- signed-in but NOT an admin ---- */
await asRole("authenticated", "random@user.com", async () => {
  const r = await db.query("select id from public.jobs order by id");
  ok("non-admin signed-in user sees only the public feed",
     r.rows.length === 1 && r.rows[0].id === "ch-cd4cd-1",
     `got ${JSON.stringify(r.rows.map(x => x.id))}`);

  const u = await db.query(`update public.jobs set status='published' where id='ch-cd4cd-3' returning id`);
  ok("non-admin cannot moderate", u.rows.length === 0);
});

/* ---- an approved admin ---- */
await asRole("authenticated", "admin@sciencejobs.sa", async () => {
  const r = await db.query("select id from public.jobs");
  ok("admin sees every job regardless of status", r.rows.length === 5, `got ${r.rows.length}`);

  const u = await db.query(`update public.jobs set status='published' where id='ch-cd4cd-3' returning id`);
  ok("admin can publish a pending job", u.rows.length === 1);

  const d = await db.query(`update public.jobs set status='deleted' where id='ch-cd4cd-1' returning id`);
  ok("admin can soft-delete (recoverable)", d.rows.length === 1);

  let blocked = false;
  try { await db.query("select * from public.meta"); } catch { blocked = true; }
  ok("admin cannot read cursors from the browser session", blocked);
});

/* ---- case-insensitive admin match ---- */
await asRole("authenticated", "ADMIN@SciencejObs.SA", async () => {
  const r = await db.query("select id from public.jobs");
  ok("admin email match is case-insensitive", r.rows.length === 5);
});

/* ---- duplicate prevention ---- */
const dupTry = async (label, cols, vals) => {
  try { await db.query(`insert into public.jobs (${cols}) values (${vals})`); return false; }
  catch (e) { return e.message.includes("duplicate key"); }
};
ok("same source post cannot be inserted twice",
   await dupTry("dup-post", "id,title", `'ch-cd4cd-1','x'`));
await db.query(`insert into public.jobs(id,dedup_url) values ('a1','https://jadarat.sa/j/9')`);
ok("same application URL cannot be inserted twice",
   await dupTry("dup-url", "id,dedup_url", `'a2','https://jadarat.sa/j/9'`));
await db.query(`insert into public.jobs(id,dedup_contact) values ('b1','+966500000000|اخصائي مختبر')`);
ok("same contact+title cannot be inserted twice",
   await dupTry("dup-contact", "id,dedup_contact", `'b2','+966500000000|اخصائي مختبر'`));
await db.query(`insert into public.jobs(id,dedup_fingerprint) values ('c1','معمل|اخصائي|الرياض|2026-08-16')`);
ok("same employer/title/city/day cannot be inserted twice",
   await dupTry("dup-fp", "id,dedup_fingerprint", `'c2','معمل|اخصائي|الرياض|2026-08-16'`));

/* a deleted row must not block a legitimate re-add */
await db.query(`update public.jobs set status='deleted' where id='a1'`);
let readded = true;
try { await db.query(`insert into public.jobs(id,dedup_url) values ('a3','https://jadarat.sa/j/9')`); }
catch { readded = false; }
ok("a deleted listing can be re-added later", readded);

/* different vacancies from the same employer must both survive */
let bothKept = true;
try {
  await db.query(`insert into public.jobs(id,dedup_contact) values ('b3','+966500000000|باحث احياء')`);
} catch { bothKept = false; }
ok("same phone, different job title -> both kept", bothKept);

/* ---- updated_at trigger ---- */
const before = (await db.query("select updated_at from public.jobs where id='ch-cd4cd-4'")).rows[0].updated_at;
await new Promise(r => setTimeout(r, 20));
await db.query(`update public.jobs set title='changed' where id='ch-cd4cd-4'`);
const after = (await db.query("select updated_at from public.jobs where id='ch-cd4cd-4'")).rows[0].updated_at;
ok("updated_at moves on edit", after > before);

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
