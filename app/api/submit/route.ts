/* Employer submissions.
 *
 * The browser never talks to Supabase here. It posts to this route, which
 * validates, forces status='pending' and source='employer', and writes with
 * the service-role key. That is why `anon` has no insert grant in schema.sql:
 * a visitor cannot self-publish even if they craft their own request.
 */

import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { dedupKeys } from "@/lib/dedup";
import { EMPLOYMENT_TYPES, SPECIALTIES } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Crude per-instance throttle. Serverless resets it on cold start, so it is a
 *  speed bump against a bored visitor, not a defence against a real flood —
 *  put Cloudflare/Vercel rate limiting in front for that. */
const hits = new Map<string, number[]>();
const WINDOW = 60 * 60 * 1000;
const LIMIT = 5;

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip") ?? "unknown";
  if (throttled(ip)) {
    return NextResponse.json({ ok: false, error: "أرسلت طلبات كثيرة. حاول لاحقاً." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 }); }

  // Honeypot: a real person never fills a field they cannot see.
  if (str(body.website, 100)) return NextResponse.json({ ok: true });

  const employer = str(body.employer, 120);
  const city = str(body.city, 60);
  const title = str(body.title, 120);
  const specialty = str(body.specialty, 40);
  const contact = str(body.contact, 200);
  const employment_type = str(body.employment_type, 30);
  const notes = str(body.notes, 1200);

  const missing = [
    !employer && "جهة العمل", !city && "المدينة", !title && "المسمى الوظيفي",
    !specialty && "التخصص", !contact && "وسيلة التقديم",
  ].filter(Boolean);
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `الحقول التالية مطلوبة: ${missing.join("، ")}` }, { status: 400 });
  }
  if (specialty && !SPECIALTIES.includes(specialty)) {
    return NextResponse.json({ ok: false, error: "تخصص غير معروف." }, { status: 400 });
  }
  if (employment_type && !EMPLOYMENT_TYPES.includes(employment_type)) {
    return NextResponse.json({ ok: false, error: "نوع دوام غير معروف." }, { status: 400 });
  }

  // One free-text "how to apply" box, sorted into the right column here.
  const email = contact!.match(/[\w.\-]+@[\w.\-]+\.\w+/)?.[0] ?? null;
  const url = contact!.match(/(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?/i)?.[0] ?? null;
  const digits = contact!.replace(/\D/g, "");
  const phone = /^(?:966|0)?5\d{8}$/.test(digits)
    ? "+966" + digits.slice(-9) : null;

  if (!email && !url && !phone) {
    return NextResponse.json(
      { ok: false, error: "وسيلة التقديم يجب أن تكون رابطاً أو بريداً أو رقم جوال." }, { status: 400 });
  }

  const row = {
    status: "pending" as const,
    source: "employer" as const,
    posted_at: new Date().toISOString(),
    employer, city, title, specialty, employment_type,
    notes,
    contact_email: email,
    contact_phone: phone,
    apply_url: url && !email?.includes(url) ? url : null,
  };

  try {
    const { error } = await serviceClient().from("jobs").insert({ ...row, ...dedupKeys(row) });
    if (error) {
      // 23505 = this vacancy is already on the board or already in the queue.
      // Reported as success on purpose: the submitter's job is listed either
      // way, and a distinct reply would let anyone probe the pending queue.
      if (error.code === "23505") return NextResponse.json({ ok: true });
      console.error("submit insert:", error);
      return NextResponse.json({ ok: false, error: "تعذّر حفظ الطلب. حاول لاحقاً." }, { status: 500 });
    }
  } catch (e) {
    console.error("submit:", e);
    return NextResponse.json({ ok: false, error: "الخدمة غير مهيأة حالياً." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
