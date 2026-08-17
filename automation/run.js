/* Reads public Telegram channels, keeps the genuine Saudi science vacancies,
 * and writes them to Supabase. Runs on GitHub Actions.
 *
 *   MODE=poll      anything newer than each channel's cursor      (the cron)
 *   MODE=backfill  everything posted in the last DAYS days        (one-off)
 *   MODE=republish promote queued Telegram jobs to published
 *   MODE=dryrun    full pipeline, prints decisions, writes nothing
 *
 * Env: FEED_CHANNELS, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *      JOB_STATUS (pending|published), DAYS, PAGES, MAX_POSTS, OCR_MIN_TEXT,
 *      TRIAGE_MODEL, EXTRACT_MODEL
 */

import { createClient } from "@supabase/supabase-js";
import { appendFileSync } from "node:fs";
import { collect, fetchImage } from "./channel.js";
import { dedupKeys } from "./dedup.js";
import { extractContacts } from "./contacts.js";

const CHANNELS = (process.env.FEED_CHANNELS || process.env.FEED_CHANNEL || "")
  .split(",").map(v => v.trim().replace(/^@/, "")).filter(Boolean);
const KEY    = process.env.ANTHROPIC_API_KEY;
const MODE   = ["backfill", "republish", "dryrun"].includes(process.env.MODE)
               ? process.env.MODE : "poll";
const DRY    = MODE === "dryrun";
const STATUS = process.env.JOB_STATUS === "published" ? "published" : "pending";

// A 30-day backfill is bounded by date, not by a guess at page count: these
// two channels differ by nearly 2x in posting rate. PAGES is only the ceiling
// that stops a runaway walk.
const DAYS  = Math.min(Math.max(Number(process.env.DAYS) || 30, 1), 90);
const PAGES = Math.min(Math.max(Number(process.env.PAGES) || 60, 1), 200);
// A ceiling per run so one bad day can't burn the whole API budget.
const MAX_POSTS = Math.min(Math.max(Number(process.env.MAX_POSTS) || 1200, 1), 4000);
// Posts with a picture and a caption thinner than this get read by vision.
const OCR_MIN_TEXT = Math.max(Number(process.env.OCR_MIN_TEXT) || 140, 0);

// Triage is ~95% of the calls and answers one boolean, so it runs on the cheap
// model; only survivors reach the extraction model.
const TRIAGE_MODEL  = process.env.TRIAGE_MODEL  || "claude-haiku-4-5-20251001";
const EXTRACT_MODEL = process.env.EXTRACT_MODEL || "claude-sonnet-4-6";
const OCR_MODEL     = process.env.OCR_MODEL     || EXTRACT_MODEL;

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!CHANNELS.length) throw new Error("FEED_CHANNELS is not set");
if (!KEY)    throw new Error("ANTHROPIC_API_KEY is not set");
if (!DRY && !SB_URL) throw new Error("SUPABASE_URL is not set");
if (!DRY && !SB_KEY) throw new Error("SUPABASE_SERVICE_KEY is not set");

// The service key bypasses row level security — this process is trusted and
// runs only inside the Action, never in a browser.
const db = SB_URL && SB_KEY
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  : null;

/* ------------------------------------------------------------ the model -- */

const TRIAGE_SYSTEM = `أنت فلتر أولي لقناة تيليجرام سعودية للوظائف.
مهمتك سؤال واحد: هل هذا المنشور إعلان شاغر وظيفي حقيقي داخل السعودية،
ومناسب لخريجي العلوم؟

التخصصات المقبولة: الأحياء، الكيمياء، الفيزياء، الأحياء الدقيقة،
الكيمياء الحيوية، التقنية الحيوية، العلوم البيئية، علوم المختبرات،
الجيولوجيا، علوم الأغذية، ووظائف المختبرات والبحث ومراقبة الجودة
وتدريس العلوم القريبة منها.

ارفض: الدورات والتدريب غير المنتهي بتوظيف، الأخبار، الإعلانات العامة،
من يعرض نفسه للعمل، الوظائف خارج السعودية، ووظائف الطب وطب الأسنان
والتمريض والهندسة وتقنية المعلومات والإدارة والمبيعات والسائقين
والأمن والضيافة، إلا إذا طلب الإعلان صراحةً إحدى شهادات العلوم أعلاه.

إعلان يجمع تخصصات كثيرة دون ذكر تخصص علمي = رفض.

أعِد JSON فقط: {"keep": true|false, "why": "سبب من ٦ كلمات"}`;

const PARSE_SYSTEM = `تستخرج بيانات وظيفة علمية من منشور تيليجرام سعودي.
المنشورات عربية غالباً وأحياناً مخلوطة بالإنجليزية. أُزيلت وسائل التواصل
قبل وصولك واستُبدلت بـ [جوال] [هاتف] [بريد] [رابط] [واتساب].

أعِد كائن JSON واحد بالمفاتيح:
  is_job          true فقط إذا كان إعلان شاغر فعلي داخل السعودية ومناسباً لخريجي
                  العلوم: الأحياء، الكيمياء، الفيزياء، الأحياء الدقيقة، الكيمياء
                  الحيوية، التقنية الحيوية، العلوم البيئية، علوم المختبرات،
                  الجيولوجيا، علوم الأغذية، أو تخصص علمي قريب.
                  false للأسئلة والردود والشكر ونقاش الرواتب ومن يعرض نفسه
                  للعمل وإعلانات الإدارة والأخبار العامة والدورات.
                  وظائف الطب وطب الأسنان والتمريض والهندسة والإدارة فقط = false.
                  إعلان عام بلا تخصص علمي واضح = false.
                  وظيفة خارج السعودية = false.
  employer        اسم الشركة أو المختبر أو الجهة، أو null
  city            المدينة بالعربية موحّدة. إن ذُكرت محافظة صغيرة ومعها
                  المنطقة، فاكتب المحافظة نفسها (حوطة بني تميم، النعيرية،
                  بريدة، ينبع، الطائف...). أمثلة شائعة: الرياض، جدة، الدمام،
                  الخبر، الظهران، الأحساء، القصيم، بريدة، عنيزة، مكة،
                  المدينة، الطائف، ينبع، أبها، خميس مشيط، تبوك، حائل،
                  نجران، جازان، الجبيل، الخرج. null إن لم تُذكر.
  district        الحي إن ذُكر، وإلا null
  title           المسمى الوظيفي المختصر كما ورد، مثل: أخصائي مختبر، باحث،
                  فني مختبر، معلم علوم، مراقب جودة، أخصائي بيئي، أو null.
  specialty       واحد من: أحياء | كيمياء | فيزياء | أحياء دقيقة | كيمياء حيوية |
                  تقنية حيوية | علوم بيئية | علوم مختبرات | جيولوجيا |
                  علوم أغذية | علوم عامة | null.
  employment_type واحد من: دوام كامل | دوام جزئي | بديل | تدريب | null
  compensation    عبارة قصيرة كما وردت: "9000 ريال"، "نسبة 40%"،
                  "8000 + بدل سكن 1000"، أو "غير مذكور".
                  لا تخترع رقماً أبداً.
  gender_pref     رجال | نساء | null
                  "أخصائي/أخصائية" أو "سعودي/ـة" تعني بلا تفضيل ← null.
                  فقط إذا نصّ المنشور على جنس واحد صراحةً.
  saudi_only      true إذا اشتُرطت الجنسية السعودية، وإلا false
  needs_scfhs     true إذا طُلب تصنيف ساري أو ترخيص من هيئة التخصصات الصحية
  notes           ١٢ كلمة كحد أقصى لأي تفصيل مفيد آخر، أو null.
                  لا تكرّر ما هو في الحقول الأخرى.
  confidence      0.0-1.0

لا تخمّن. المعلومة الغائبة null وليست حشواً معقولاً.
أعِد JSON فقط، بلا نص أو علامات markdown.`;

let apiCalls = 0, inTokens = 0, outTokens = 0;

async function anthropic(body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      if (attempt === 3) throw netErr;
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
      continue;
    }
    if (r.ok) {
      const data = await r.json();
      apiCalls++;
      inTokens += data.usage?.input_tokens ?? 0;
      outTokens += data.usage?.output_tokens ?? 0;
      return data.content.filter(b => b.type === "text").map(b => b.text).join("");
    }
    const detail = await r.text().catch(() => "");
    // 429 and 5xx are worth waiting out; anything else is our own fault and
    // retrying it just spends money — a wrong model name is the usual cause.
    if (r.status !== 429 && r.status < 500) {
      throw new Error(`anthropic ${r.status}: ${detail.slice(0, 300)}`);
    }
    await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
  }
  throw new Error("anthropic: retries exhausted");
}

function parseJson(out) {
  const cleaned = out.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // Models occasionally wrap JSON in a sentence; take the outermost object.
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("model did not return JSON");
  return JSON.parse(cleaned.slice(s, e + 1));
}

async function triage(text) {
  return parseJson(await anthropic({
    model: TRIAGE_MODEL,
    max_tokens: 120,
    system: TRIAGE_SYSTEM,
    messages: [{ role: "user", content: text.slice(0, 4000) }],
  }));
}

async function parsePost(text) {
  return parseJson(await anthropic({
    model: EXTRACT_MODEL,
    max_tokens: 700,
    system: PARSE_SYSTEM,
    messages: [{ role: "user", content: text }],
  }));
}

/** Job ads are often a picture with a one-line caption. Read the image. */
async function ocrImage(url) {
  const { base64, mediaType } = await fetchImage(url);
  const out = await anthropic({
    model: OCR_MODEL,
    max_tokens: 1200,
    system:
      "انسخ كل النص الظاهر في الصورة كما هو، بالعربية أو الإنجليزية، " +
      "بما في ذلك أرقام الجوال والبريد وأسماء الجهات. " +
      "حافظ على ترتيب الأسطر. لا تترجم ولا تلخّص ولا تشرح. " +
      "إن لم تجد نصاً فأعد كلمة: لا_نص",
    messages: [{
      role: "user",
      content: [
        { type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "انسخ النص." },
      ],
    }],
  });
  const t = out.trim();
  return t === "لا_نص" ? "" : t;
}

/* ------------------------------------------------------------- ingestion -- */

/* Which of these are already stored? One query instead of one per post —
 * cheap here, and it keeps the model calls to genuinely new material. */
async function existingIds(ids) {
  if (!db || !ids.length) return new Set();
  const { data, error } = await db.from("jobs").select("id").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.id));
}

/** Second dedup gate. The unique indexes are the real guarantee, but checking
 *  first avoids burning an extraction call on a vacancy we already hold. */
async function alreadyHave(keys) {
  if (!db) return false;
  const filters = [];
  if (keys.dedup_url) filters.push(`dedup_url.eq.${encodeURIComponent(keys.dedup_url)}`);
  if (keys.dedup_contact) filters.push(`dedup_contact.eq.${encodeURIComponent(keys.dedup_contact)}`);
  if (keys.dedup_fingerprint) filters.push(`dedup_fingerprint.eq.${encodeURIComponent(keys.dedup_fingerprint)}`);
  if (!filters.length) return false;
  const { data, error } = await db.from("jobs")
    .select("id").or(filters.join(",")).neq("status", "deleted").limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** → "added" | "rejected" | "duplicate" */
async function ingest(p, seen, log) {
  const id = `ch-${p.channel}-${p.id}`;
  if (seen.has(id)) return "duplicate";

  let body = (p.text || "").trim();
  let fromImage = false;
  if (body.length < OCR_MIN_TEXT && p.photos.length) {
    const shot = await ocrImage(p.photos[0]);
    if (shot) { body = `${body}\n${shot}`.trim(); fromImage = true; }
  }
  if (body.length < 30) return "rejected";

  // Stage 1: cheap boolean. ~90% of a general jobs channel dies here.
  const t = await triage(body);
  if (!t.keep) {
    log?.({ id, verdict: "rejected", why: t.why, text: body.slice(0, 90) });
    return "rejected";
  }

  // Stage 2: full extraction on the survivors only.
  const { phone, email, apply_url, masked } = extractContacts(body, p.links);
  const j = await parsePost(masked);
  if (!j.is_job || (j.confidence ?? 0) < 0.5) {
    log?.({ id, verdict: "rejected", why: `extract is_job=${j.is_job} conf=${j.confidence}`,
            text: body.slice(0, 90) });
    return "rejected";
  }

  const row = {
    id,
    status: STATUS,
    source: "telegram",
    source_channel: p.channel,
    post_id: p.id,
    posted_at: p.posted_at ?? new Date().toISOString(),
    // Link to the original group post when the forward header exposes it.
    permalink: p.source_link ?? p.permalink,
    relay_link: p.permalink,
    from_image: fromImage,
    employer: j.employer ?? null,
    city: j.city ?? null,
    district: j.district ?? null,
    title: j.title ?? null,
    specialty: j.specialty ?? null,
    employment_type: j.employment_type ?? null,
    compensation: j.compensation ?? null,
    gender_pref: (j.gender_pref === "رجال" || j.gender_pref === "نساء") ? j.gender_pref : null,
    notes: j.notes ?? null,
    contact_phone: phone,
    contact_email: email,
    apply_url,
    saudi_only: j.saudi_only ?? null,
    needs_scfhs: j.needs_scfhs ?? null,
    ai_confidence: j.confidence ?? null,
    raw_excerpt: body.slice(0, 1500),
  };
  Object.assign(row, dedupKeys(row));

  log?.({ id, verdict: "accepted", title: row.title, city: row.city,
          specialty: row.specialty, employer: row.employer, ocr: fromImage,
          conf: row.ai_confidence, apply: row.apply_url });

  if (DRY) return "added";

  if (await alreadyHave(row)) return "duplicate";

  const { error } = await db.from("jobs").insert(row);
  // 23505 = a unique index caught what the pre-check missed, usually because a
  // parallel run inserted it first. That is a duplicate, not a failure.
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw error;
  }
  return "added";
}

/* ------------------------------------------------------------------ main -- */

if (MODE === "republish") {
  // Promote Telegram jobs that are still sitting in the review queue.
  // Employer submissions (source: "employer") are deliberately left alone —
  // those always need a human look.
  const { data, error } = await db.from("jobs")
    .update({ status: "published" })
    .eq("status", "pending").eq("source", "telegram")
    .select("id");
  if (error) throw error;
  console.log(`republish: promoted ${data?.length ?? 0} telegram job(s) to published`);
  process.exit(0);
}

if (!DRY) {
  // Hide published jobs after 30 days while retaining them for audit/recovery.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: exp, error: expiryError } = await db.from("jobs")
    .update({ status: "expired" })
    .eq("status", "published").lt("posted_at", cutoff).select("id");
  if (expiryError) throw expiryError;
  if (exp?.length) console.log(`expiry: ${exp.length} job(s) moved to expired`);
}

const since = MODE === "backfill"
  ? new Date(Date.now() - DAYS * 86400000).toISOString() : null;
const report = [];

for (const channel of CHANNELS) {
  const stats = { channel, scanned: 0, added: 0, rejected: 0, duplicate: 0, failed: 0 };
  try {
    const cursorKey = `channel_cursor_${channel}`;
    let lastId = 0;
    if (db) {
      const { data: curRow, error } = await db.from("meta")
        .select("value").eq("key", cursorKey).maybeSingle();
      if (error) throw error;
      lastId = Number(curRow?.value ?? 0);
    }

    let posts = (MODE === "backfill")
      ? await collect(channel, { maxPages: PAGES, sinceDate: since })
      : await collect(channel, { stopAfterId: lastId, maxPages: lastId ? 3 : 1 });

    if (posts.length > MAX_POSTS) {
      console.log(`@${channel}: capping ${posts.length} posts at MAX_POSTS=${MAX_POSTS}`);
      posts = posts.slice(0, MAX_POSTS);
    }
    stats.scanned = posts.length;
    console.log(`${MODE}: @${channel} — ${posts.length} post(s), cursor ${lastId}`);

    const seen = await existingIds(posts.map(p => `ch-${p.channel}-${p.id}`));
    const log = DRY ? d => console.log("   " + JSON.stringify(d, null, 0)) : null;

    for (const p of posts) {
      try {
        const outcome = await ingest(p, seen, log);
        stats[outcome]++;
      } catch (e) {
        console.error(`@${channel}/${p.id} failed: ${e.message}`);
        stats.failed++;
        // A bad key or a wrong model name fails on every single post; stop
        // rather than grinding through a thousand identical errors.
        if (/anthropic 4\d\d/.test(e.message) && stats.failed >= 5 && !stats.added) {
          throw new Error(`aborting @${channel}: ${e.message}`);
        }
      }
    }

    // Cursor only moves for channels we actually finished, and only forward.
    if (posts.length && db && !DRY) {
      const newest = posts[posts.length - 1].id;
      if (newest > lastId) {
        const { error } = await db.from("meta").upsert(
          { key: cursorKey, value: String(newest), updated_at: new Date().toISOString() },
          { onConflict: "key" });
        if (error) throw error;
      }
    }
  } catch (e) {
    console.error(`@${channel}: ${e.message}`);
    stats.failed++;
  }
  report.push(stats);
}

/* ---------------------------------------------------------------- report -- */

const head = "| channel | scanned | added | rejected | duplicate | failed |";
const rule = "|---|---:|---:|---:|---:|---:|";
const rows = report.map(s =>
  `| @${s.channel} | ${s.scanned} | ${s.added} | ${s.rejected} | ${s.duplicate} | ${s.failed} |`);
const total = report.reduce((a, s) => ({
  scanned: a.scanned + s.scanned, added: a.added + s.added,
  rejected: a.rejected + s.rejected, duplicate: a.duplicate + s.duplicate,
  failed: a.failed + s.failed,
}), { scanned: 0, added: 0, rejected: 0, duplicate: 0, failed: 0 });
rows.push(`| **total** | **${total.scanned}** | **${total.added}** | ` +
          `**${total.rejected}** | **${total.duplicate}** | **${total.failed}** |`);

const summary = [
  `### ${MODE}${DRY ? " (nothing written)" : ""} → status \`${STATUS}\``,
  "", head, rule, ...rows, "",
  `Anthropic calls: ${apiCalls} · input ${inTokens} tok · output ${outTokens} tok`,
].join("\n");

console.log("\n" + summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

// Fail the run only when nothing worked — a handful of unreadable posts is
// normal and should not turn the schedule red.
if (total.failed && !total.added && !total.rejected) process.exitCode = 1;
