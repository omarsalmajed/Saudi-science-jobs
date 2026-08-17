"use server";

/* Every action here re-checks who is calling. The session cookie is the only
 * input we trust, and even then the write goes through the anon-key session
 * client so row level security gets the final say — if `is_admin()` is false
 * in Postgres, the update simply affects nothing. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessionClient, serviceClient } from "@/lib/supabase/server";
import { dedupKeys } from "@/lib/dedup";
import type { Job, JobStatus } from "@/lib/jobs";

export type AdminIdentity = { email: string; isAdmin: boolean } | null;

export async function currentAdmin(): Promise<AdminIdentity> {
  const sb = await sessionClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return null;

  const { data } = await sb.from("admins").select("email").limit(1);
  return { email: user.email, isAdmin: (data ?? []).length > 0 };
}

async function requireAdmin() {
  const who = await currentAdmin();
  if (!who?.isAdmin) throw new Error("غير مصرّح");
  return who;
}

/* ------------------------------------------------------------------ auth -- */

/* The actions below are used directly as <form action={...}>, so they take a
 * FormData and report back through the query string. No client-side state, no
 * extra bundle — the admin page stays a server component end to end. */

function back(tab: string, message?: string): never {
  const q = new URLSearchParams({ tab });
  if (message) q.set("msg", message);
  redirect(`/admin?${q}`);
}

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) back("المنشورة", "أدخل البريد وكلمة المرور.");

  const sb = await sessionClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  // Deliberately vague: a precise message tells a stranger which addresses are
  // real accounts.
  if (error) back("المنشورة", "بيانات الدخول غير صحيحة.");

  revalidatePath("/admin");
  back("المنشورة");
}

export async function signOut() {
  const sb = await sessionClient();
  await sb.auth.signOut();
  redirect("/admin");
}

/* ------------------------------------------------------------ moderation -- */

const STATUSES: JobStatus[] = ["pending", "published", "expired", "deleted"];

export async function setStatus(form: FormData) {
  const who = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "") as JobStatus;
  const tab = String(form.get("tab") ?? "المنشورة");
  if (!id || !STATUSES.includes(status)) back(tab, "طلب غير صالح.");

  const sb = await sessionClient();
  const { data, error } = await sb.from("jobs")
    .update({ status, reviewed_by: who.email, reviewed_at: new Date().toISOString() })
    .eq("id", id).select("id");
  if (error) back(tab, error.message);
  if (!data?.length) back(tab, "لم يتم تغيير أي سجل.");
  revalidatePath("/admin"); revalidatePath("/");
  back(tab, "تم التحديث.");
}

const EDITABLE = ["employer", "title", "specialty", "city", "district", "employment_type",
  "compensation", "gender_pref", "notes", "contact_phone", "contact_email", "apply_url"] as const;

export async function updateJob(form: FormData) {
  const who = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const tab = String(form.get("tab") ?? "المنشورة");
  if (!id) back(tab, "معرّف مفقود.");

  const patch: Record<string, string | null> = {};
  for (const field of EDITABLE) {
    if (!form.has(field)) continue;
    const v = String(form.get(field) ?? "").trim();
    patch[field] = v === "" ? null : v.slice(0, 1200);
  }
  patch.reviewed_by = who.email;
  patch.reviewed_at = new Date().toISOString();

  const sb = await sessionClient();
  // Editing a title or employer changes what counts as a duplicate, so the
  // keys are recomputed rather than left pointing at the old wording.
  const { data: before } = await sb.from("jobs").select("*").eq("id", id).maybeSingle();
  const merged = { ...(before ?? {}), ...patch } as Job;
  Object.assign(patch, dedupKeys(merged));

  const { data, error } = await sb.from("jobs").update(patch).eq("id", id).select("id");
  if (error) back(tab, error.message);
  if (!data?.length) back(tab, "لم يتم تغيير أي سجل.");
  revalidatePath("/admin"); revalidatePath("/");
  back(tab, "تم حفظ التعديل.");
}

export async function addManualJob(form: FormData) {
  const who = await requireAdmin();
  const get = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" ? null : v.slice(0, 1200);
  };
  if (!get("title") || !get("city")) back("إضافة", "المسمى والمدينة مطلوبان.");

  const row = {
    status: (String(form.get("status") ?? "published") === "pending" ? "pending" : "published") as JobStatus,
    source: "employer" as const,
    posted_at: new Date().toISOString(),
    employer: get("employer"), title: get("title"), specialty: get("specialty"),
    city: get("city"), district: get("district"), employment_type: get("employment_type"),
    compensation: get("compensation"), notes: get("notes"),
    contact_phone: get("contact_phone"), contact_email: get("contact_email"),
    apply_url: get("apply_url"),
    reviewed_by: who.email, reviewed_at: new Date().toISOString(),
  };

  const sb = await sessionClient();
  const { error } = await sb.from("jobs").insert({ ...row, ...dedupKeys(row) });
  if (error) back("إضافة", error.code === "23505" ? "هذه الوظيفة مضافة مسبقاً." : error.message);
  revalidatePath("/admin"); revalidatePath("/");
  back("المنشورة", "تمت الإضافة.");
}

/* ----------------------------------------------------------------- data -- */

export async function loadJobs(status: JobStatus | "all"): Promise<Job[]> {
  await requireAdmin();
  const sb = await sessionClient();
  let q = sb.from("jobs").select("*").order("posted_at", { ascending: false }).limit(300);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export type AdminStats = {
  counts: Record<string, number>;
  bySource: Record<string, number>;
  byChannel: { channel: string; count: number }[];
  cursors: { channel: string; lastPost: string; movedAt: string | null }[];
  ocrCount: number;
  last24h: number;
};

export async function loadStats(): Promise<AdminStats> {
  await requireAdmin();
  // Cursors live in `meta`, which no browser session can read — that is the
  // point of it having RLS on and no policy. Read them with the service key
  // only after the caller has been confirmed as an admin.
  const svc = serviceClient();

  const { data: jobs } = await svc.from("jobs")
    .select("status, source, source_channel, from_image, created_at").limit(20000);
  const rows = jobs ?? [];

  const tally = (pick: (r: typeof rows[number]) => string | null) =>
    rows.reduce<Record<string, number>>((acc, r) => {
      const k = pick(r); if (!k) return acc;
      acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {});

  const { data: meta } = await svc.from("meta").select("*").like("key", "channel_cursor_%");
  const dayAgo = Date.now() - 86400000;

  return {
    counts: tally(r => r.status),
    bySource: tally(r => r.source),
    byChannel: Object.entries(tally(r => r.source_channel))
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count),
    cursors: (meta ?? []).map(m => ({
      channel: String(m.key).replace("channel_cursor_", ""),
      lastPost: String(m.value ?? "—"),
      movedAt: m.updated_at ?? null,
    })),
    ocrCount: rows.filter(r => r.from_image).length,
    last24h: rows.filter(r => r.created_at && new Date(r.created_at).getTime() > dayAgo).length,
  };
}
