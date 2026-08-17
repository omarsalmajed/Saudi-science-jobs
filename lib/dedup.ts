/* Duplicate identity — a straight port of automation/dedup.js.
 * The two runtimes are separate npm packages, so the logic is mirrored rather
 * than shared; test/parity.test.mjs asserts they never drift apart.
 *
 * Duplicate identity.
 *
 * The same vacancy reaches us more than once in four different disguises, so
 * we derive four independent keys and let Postgres reject a collision on any
 * of them (see the partial unique indexes in schema.sql):
 *
 *   1. the source post itself  — the row id, ch-<channel>-<post_id>
 *   2. the application URL     — the strongest cross-channel signal
 *   3. contact + job title     — same phone, same role, re-posted next week
 *   4. employer/title/city/day — an ad copied by hand into another channel
 *
 * Keys 3 and 4 deliberately include the title: a busy lab posts five different
 * vacancies behind one phone number, and collapsing those would lose four
 * real jobs.
 */

/** Arabic spelling varies post to post; fold it before comparing. */
export function normaliseAr(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")   // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[^\p{L}\p{N}]+/gu, " ")               // punctuation, emoji
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Same destination, different decoration: tracking params, case, trailing /. */
export function normaliseUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
  let u: URL;
  try { u = new URL(raw); } catch { return null; }

  for (const p of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|igshid|ref|source$)/i.test(p)) u.searchParams.delete(p);
  }
  // Host is case-insensitive, the path is not: bit.ly/aB and bit.ly/Ab are
  // two different links and must not collapse into one.
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const qs = u.searchParams.toString();
  return `${host}${path}${qs ? "?" + qs : ""}`;
}

/** All four keys for one candidate row. Null means "this signal is absent" —
 *  the partial indexes ignore nulls, so a job with no URL is never treated as
 *  a duplicate of another job with no URL. */
export type DedupInput = {
  apply_url?: string | null; contact_phone?: string | null; contact_email?: string | null;
  title?: string | null; employer?: string | null; city?: string | null; posted_at?: string | null;
};

export type DedupKeys = {
  dedup_url: string | null; dedup_contact: string | null; dedup_fingerprint: string | null;
};

export function dedupKeys(
  { apply_url, contact_phone, contact_email, title, employer, city, posted_at }: DedupInput
): DedupKeys {
  const t = normaliseAr(title);
  const contact = contact_phone || (contact_email ? contact_email.toLowerCase() : null);
  const day = posted_at ? new Date(posted_at).toISOString().slice(0, 10) : null;

  const fingerprintParts = [normaliseAr(employer), t, normaliseAr(city), day];
  const haveFingerprint = fingerprintParts.filter(Boolean).length >= 3 && Boolean(t);

  return {
    dedup_url: normaliseUrl(apply_url),
    dedup_contact: contact && t ? `${contact}|${t}` : null,
    dedup_fingerprint: haveFingerprint ? fingerprintParts.join("|") : null,
  };
}
