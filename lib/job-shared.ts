/* Types and pure helpers shared by both server and client code.
 *
 * Deliberately has ZERO imports from "@/lib/supabase/server" (which pulls in
 * next/headers). A client component — JobBoard.tsx, submit/page.tsx — must
 * import from here, never from "@/lib/jobs" directly, or the bundler drags
 * the server-only Supabase client into the browser and the build fails.
 */

export type JobStatus = "pending" | "published" | "expired" | "deleted";

export type Job = {
  id: string;
  status: JobStatus;
  source: "telegram" | "employer";
  source_channel: string | null;
  post_id: number | null;
  permalink: string | null;
  relay_link: string | null;
  posted_at: string;
  employer: string | null;
  title: string | null;
  specialty: string | null;
  city: string | null;
  district: string | null;
  employment_type: string | null;
  compensation: string | null;
  gender_pref: string | null;
  saudi_only: boolean | null;
  needs_scfhs: boolean | null;
  notes: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  apply_url: string | null;
  from_image: boolean;
  ai_confidence: number | null;
  raw_excerpt?: string | null;
};

/** Filter pills on the public page. Fixed order, so the row does not reshuffle
 *  every time the mix of live vacancies changes. */
export const SPECIALTIES = [
  "أحياء", "كيمياء", "فيزياء", "أحياء دقيقة", "كيمياء حيوية", "تقنية حيوية",
  "علوم بيئية", "علوم مختبرات", "جيولوجيا", "علوم أغذية", "علوم عامة",
];

export const EMPLOYMENT_TYPES = ["دوام كامل", "دوام جزئي", "بديل", "تدريب"];

/** "اليوم" / "أمس" / "14 أغسطس" — the format the approved design uses. */
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function arabicDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (a: Date) => Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return "اليوم";
  if (diff === 1) return "أمس";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** What the card shows when the visitor taps "إظهار وسيلة التواصل". */
export function contactTarget(job: Job): { href: string; label: string } | null {
  if (job.apply_url) {
    const href = /^https?:\/\//i.test(job.apply_url) ? job.apply_url : `https://${job.apply_url}`;
    return { href, label: "رابط التقديم ↗" };
  }
  if (job.contact_phone) return { href: `tel:${job.contact_phone}`, label: job.contact_phone };
  if (job.contact_email) return { href: `mailto:${job.contact_email}`, label: job.contact_email };
  if (job.permalink) return { href: job.permalink, label: "المنشور الأصلي ↗" };
  return null;
}
