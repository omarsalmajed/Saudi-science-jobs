/* Admin dashboard. Server component throughout: the tabs are links, the
 * actions are forms, and nothing about the queue reaches the browser until
 * Supabase has confirmed the caller is on the allowlist. */

import Link from "next/link";
import {
  addManualJob, currentAdmin, loadJobs, loadStats, setStatus, signIn, signOut, updateJob,
} from "./actions";
import { arabicDate, EMPLOYMENT_TYPES, SPECIALTIES, type Job, type JobStatus } from "@/lib/jobs";
import { configured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS = ["المنشورة", "قيد المراجعة", "المنتهية", "إضافة", "الاستيراد", "الإحصاءات"] as const;
const TAB_STATUS: Record<string, JobStatus> = {
  "المنشورة": "published", "قيد المراجعة": "pending", "المنتهية": "expired",
};

function Shell({ children }: { children: React.ReactNode }) {
  return <main dir="rtl" className="innerPage">
    <header className="topbar"><Link className="brand" href="/"><span className="brandMark">س</span><span><b>لوحة الإدارة</b><small>Saudi Science Jobs</small></span></Link><nav><Link href="/">عرض الموقع</Link></nav></header>
    {children}
  </main>;
}

function Login({ msg }: { msg?: string }) {
  return <Shell><section className="pageHero"><p className="eyebrow">دخول المشرفين</p><h1>تسجيل الدخول</h1><p>هذه الصفحة مخصصة للمشرفين المعتمدين.</p></section>
    <form className="formPanel" action={signIn}>
      <div className="formGrid">
        <label className="wide">البريد الإلكتروني<input name="email" type="email" required autoComplete="username" /></label>
        <label className="wide">كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label>
      </div>
      {msg ? <p style={{ color: "#b3261e", fontSize: 13, marginTop: 18 }}>{msg}</p> : null}
      <button className="primary" type="submit">دخول</button>
    </form></Shell>;
}

function Row({ job, tab }: { job: Job; tab: string }) {
  const label = job.source === "employer" ? "جهة عمل" : `@${job.source_channel ?? "telegram"}`;
  const link = job.permalink ?? job.relay_link ?? job.apply_url;
  return <article>
    <div style={{ flex: 1 }}>
      <span className="category">{job.status === "published" ? "منشور" : job.status === "pending" ? "بانتظار المراجعة" : job.status === "expired" ? "منتهية" : "محذوف"}</span>
      {job.from_image ? <span className="source" style={{ marginRight: 8 }}>OCR</span> : null}
      {job.ai_confidence != null ? <span className="source" style={{ marginRight: 8 }}>{job.ai_confidence.toFixed(2)}</span> : null}
      <h3>{job.title ?? "—"}</h3>
      <p>{[job.city, job.employer, label, arabicDate(job.posted_at)].filter(Boolean).join(" · ")}</p>
      {link ? <p><a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)" }}>المصدر ↗</a></p> : null}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>تعديل الحقول</summary>
        <form action={updateJob} className="formGrid" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={job.id} /><input type="hidden" name="tab" value={tab} />
          <label>المسمى<input name="title" defaultValue={job.title ?? ""} /></label>
          <label>جهة العمل<input name="employer" defaultValue={job.employer ?? ""} /></label>
          <label>المدينة<input name="city" defaultValue={job.city ?? ""} /></label>
          <label>الحي<input name="district" defaultValue={job.district ?? ""} /></label>
          <label>التخصص<select name="specialty" defaultValue={job.specialty ?? ""}><option value="">—</option>{SPECIALTIES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>نوع الدوام<select name="employment_type" defaultValue={job.employment_type ?? ""}><option value="">—</option>{EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>الراتب<input name="compensation" defaultValue={job.compensation ?? ""} /></label>
          <label>رابط التقديم<input name="apply_url" defaultValue={job.apply_url ?? ""} /></label>
          <label>جوال<input name="contact_phone" defaultValue={job.contact_phone ?? ""} /></label>
          <label>بريد<input name="contact_email" defaultValue={job.contact_email ?? ""} /></label>
          <label className="wide">ملاحظات<textarea name="notes" rows={2} defaultValue={job.notes ?? ""} /></label>
          <button className="primary" type="submit" style={{ marginTop: 0 }}>حفظ</button>
        </form>
        {job.raw_excerpt ? <p style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>{job.raw_excerpt.slice(0, 600)}</p> : null}
      </details>
    </div>
    <div>
      {job.status !== "published" ? <form action={setStatus}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="tab" value={tab} /><input type="hidden" name="status" value="published" /><button type="submit">نشر</button></form> : null}
      {job.status === "published" ? <form action={setStatus}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="tab" value={tab} /><input type="hidden" name="status" value="expired" /><button type="submit">إخفاء</button></form> : null}
      <form action={setStatus}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="tab" value={tab} /><input type="hidden" name="status" value="deleted" /><button type="submit">حذف</button></form>
    </div>
  </article>;
}

export default async function Admin({
  searchParams,
}: { searchParams: Promise<{ tab?: string; msg?: string }> }) {
  const { tab: rawTab, msg } = await searchParams;
  const tab = TABS.includes((rawTab ?? "") as typeof TABS[number]) ? rawTab! : "المنشورة";

  if (!configured) {
    return <Shell><section className="adminWrap"><div className="adminPanel"><h2>غير مهيأ</h2><p>أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY ثم أعد النشر.</p></div></section></Shell>;
  }

  const who = await currentAdmin();
  if (!who) return <Login msg={msg} />;
  if (!who.isAdmin) {
    return <Shell><section className="adminWrap"><div className="adminPanel"><h2>غير مصرّح</h2><p>الحساب {who.email} ليس ضمن المشرفين المعتمدين.</p><form action={signOut}><button className="primary" type="submit">خروج</button></form></div></section></Shell>;
  }

  const stats = await loadStats();
  const jobs = TAB_STATUS[tab] ? await loadJobs(TAB_STATUS[tab]) : [];

  return <Shell><section className="adminWrap">
    <div className="adminTitle">
      <div><p className="eyebrow">إدارة المحتوى</p><h1>الوظائف العلمية</h1></div>
      <form action={signOut}><button className="primary" type="submit">خروج ({who.email})</button></form>
    </div>

    {msg ? <p style={{ color: "var(--teal)", fontSize: 13 }}>{msg}</p> : null}

    <div className="kpis">
      <div><b>{stats.counts.published ?? 0}</b><span>منشورة</span></div>
      <div><b>{stats.counts.pending ?? 0}</b><span>بانتظار المراجعة</span></div>
      <div><b>{stats.cursors.length}</b><span>قنوات مراقبة</span></div>
      <div><b>{stats.last24h}</b><span>أُضيفت خلال ٢٤ ساعة</span></div>
    </div>

    <div className="adminTabs">{TABS.map(t => <Link key={t} href={`/admin?tab=${encodeURIComponent(t)}`} className={tab === t ? "active" : ""} style={{ padding: "12px 16px", color: tab === t ? "var(--teal)" : "var(--muted)", fontWeight: tab === t ? 700 : 400, borderBottom: tab === t ? "2px solid var(--teal)" : "none" }}>{t}</Link>)}</div>

    {tab === "الاستيراد" ? <div className="adminPanel">
      <h2>قنوات تيليجرام</h2>
      <p>يتم الفحص تلقائياً كل 30 دقيقة عبر GitHub Actions. القنوات تُضبط من متغيّر FEED_CHANNELS.</p>
      {stats.cursors.length ? stats.cursors.map(c => <div className="channel" key={c.channel}>
        <code>@{c.channel}</code>
        <span>آخر منشور {c.lastPost} · {c.movedAt ? new Date(c.movedAt).toLocaleString("ar-SA") : "—"}</span>
      </div>) : <p>لم تُسجَّل أي دورة فحص بعد.</p>}
      <h2 style={{ marginTop: 24 }}>الوظائف حسب القناة</h2>
      {stats.byChannel.map(c => <div className="channel" key={c.channel}><code>@{c.channel}</code><span>{c.count}</span></div>)}
    </div>

    : tab === "الإحصاءات" ? <div className="adminPanel">
      <h2>ملخص الأداء</h2>
      {Object.entries(stats.counts).map(([k, v]) => <div className="channel" key={k}><code>{k}</code><span>{v}</span></div>)}
      <div className="channel"><code>من تيليجرام</code><span>{stats.bySource.telegram ?? 0}</span></div>
      <div className="channel"><code>من جهات العمل</code><span>{stats.bySource.employer ?? 0}</span></div>
      <div className="channel"><code>استُخرجت من صورة (OCR)</code><span>{stats.ocrCount}</span></div>
    </div>

    : tab === "إضافة" ? <div className="adminPanel">
      <h2>شاغر جديد</h2>
      <form action={addManualJob} className="formGrid" style={{ marginTop: 16 }}>
        <label>المسمى *<input name="title" required /></label>
        <label>المدينة *<input name="city" required /></label>
        <label>جهة العمل<input name="employer" /></label>
        <label>الحي<input name="district" /></label>
        <label>التخصص<select name="specialty" defaultValue="">{["", ...SPECIALTIES].map(s => <option key={s} value={s}>{s || "—"}</option>)}</select></label>
        <label>نوع الدوام<select name="employment_type" defaultValue="">{["", ...EMPLOYMENT_TYPES].map(t => <option key={t} value={t}>{t || "—"}</option>)}</select></label>
        <label>الراتب<input name="compensation" /></label>
        <label>رابط التقديم<input name="apply_url" /></label>
        <label>جوال<input name="contact_phone" /></label>
        <label>بريد<input name="contact_email" /></label>
        <label>الحالة<select name="status" defaultValue="published"><option value="published">منشورة</option><option value="pending">قيد المراجعة</option></select></label>
        <label className="wide">ملاحظات<textarea name="notes" rows={3} /></label>
        <button className="primary" type="submit" style={{ marginTop: 0 }}>حفظ</button>
      </form>
    </div>

    : <div className="adminList">
      {jobs.length ? jobs.map(j => <Row key={j.id} job={j} tab={tab} />)
        : <div className="empty">لا توجد سجلات في هذا القسم.</div>}
    </div>}
  </section></Shell>;
}
