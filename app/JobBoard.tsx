"use client";

/* The approved layout, unchanged. The only difference from the handoff version
 * is that `jobs` arrives from Supabase instead of being a literal array, so
 * every class name and every element here is deliberately identical. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { arabicDate, contactTarget, SPECIALTIES, type Job } from "@/lib/job-shared";

const specialties = ["الكل", ...SPECIALTIES];

function LabMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 3h6M10 3v5.2l-4.7 8.3A3 3 0 0 0 7.9 21h8.2a3 3 0 0 0 2.6-4.5L14 8.2V3M7.2 14h9.6M9.4 17.2h5.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function TikTokIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14.4 3c.4 2.2 1.7 3.6 3.9 4v3.1a8.7 8.7 0 0 1-3.8-1.2v6.2a5.6 5.6 0 1 1-4.9-5.5v3.2a2.5 2.5 0 1 0 1.7 2.3V3h3.1Z" />
  </svg>;
}

/** The card's grey line: whatever the ad actually stated, nothing invented. */
function detailLine(job: Job): string {
  const bits: string[] = [];
  if (job.compensation && job.compensation !== "غير مذكور") bits.push(job.compensation);
  if (job.saudi_only) bits.push("للسعوديين");
  if (job.needs_scfhs) bits.push("يتطلب تصنيف");
  if (job.gender_pref) bits.push(job.gender_pref);
  if (job.notes) bits.push(job.notes);
  return bits.join(" · ");
}

export default function JobBoard({ jobs, notice }: { jobs: Job[]; notice?: string | null }) {
  const [specialty, setSpecialty] = useState("الكل"),
    [city, setCity] = useState("الكل"),
    [query, setQuery] = useState(""),
    [revealed, setRevealed] = useState<string[]>([]);

  const cities = ["الكل", ...Array.from(new Set(jobs.map(j => j.city).filter(Boolean) as string[]))];
  // Only offer a specialty pill if something live actually matches it.
  const activeSpecialties = specialties.filter(
    s => s === "الكل" || jobs.some(j => j.specialty === s));

  const visible = useMemo(() => jobs.filter(j =>
    (specialty === "الكل" || j.specialty === specialty) &&
    (city === "الكل" || j.city === city) &&
    (!query || `${j.title ?? ""} ${j.employer ?? ""} ${j.city ?? ""} ${j.specialty ?? ""} ${j.notes ?? ""}`
      .includes(query.trim()))), [jobs, specialty, city, query]);

  const grouped = Array.from(new Set(visible.map(j => j.city ?? "غير محددة")))
    .map(c => ({ city: c, jobs: visible.filter(j => (j.city ?? "غير محددة") === c) }));

  return <main dir="rtl">
    <header className="topbar"><a className="brand" href="#"><span className="brandMark"><LabMark /></span><span><b>وظائف العلوم</b><small>Saudi Science Jobs</small></span></a><nav><a href="#jobs">الوظائف</a><a href="#about">عن المنصة</a><Link className="outline" href="/submit"><span className="plus" aria-hidden="true">+</span><span>أضف وظيفة</span></Link></nav></header>
    <section className="hero"><div className="heroInner"><p className="eyebrow">منصة سعودية متخصصة</p><h1>فرص العلوم في مكان واحد</h1><p className="lead">نجمع أحدث الوظائف العلمية في المملكة من القنوات الموثوقة، ونرتبها حسب التخصص والمدينة.</p><div className="search"><span>⌕</span><input aria-label="ابحث في الوظائف" placeholder="ابحث بمسمى الوظيفة أو جهة العمل" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="heroStats"><span><b>{jobs.length}</b> وظيفة متاحة</span><i></i><span><b>{cities.length - 1}</b> مدن</span><i></i><span>تحديث كل <b>5 دقائق</b></span></div></div></section>
    <section className="filters" id="jobs"><div className="filterBlock"><label>التخصص</label><div className="pills">{activeSpecialties.map(s => <button key={s} className={specialty === s ? "active" : ""} onClick={() => setSpecialty(s)}>{s}</button>)}</div></div><div className="filterBlock"><label>المدينة</label><div className="pills">{cities.map(c => <button key={c} className={city === c ? "active" : ""} onClick={() => setCity(c)}>{c}</button>)}</div></div></section>
    <section className="ledger"><div className="ledgerHead"><div><span className="liveDot"></span> الوظائف المتاحة الآن</div><span>{visible.length} نتائج</span></div>{grouped.length ? grouped.map(group => <section className="cityGroup" key={group.city}><h2><span>{group.city}</span><em>{group.jobs.length}</em></h2><div className="cards">{group.jobs.map(job => {
      const target = contactTarget(job);
      const details = detailLine(job);
      return <article className="job" key={job.id}><div className="jobTop"><div><span className="category">{job.specialty ?? "علوم عامة"}</span><span className="fresh">{arabicDate(job.posted_at)}</span></div><span className="source">{job.source === "employer" ? "جهة عمل" : "تيليجرام"}</span></div><h3>{job.title ?? "شاغر علمي"}</h3><p className="employer">{job.employer ?? "جهة غير مسماة"}</p><div className="meta"><span>⌖ {job.city ?? "غير محددة"}{job.district ? ` · ${job.district}` : ""}</span><span>◷ {job.employment_type ?? "غير محدد"}</span></div><p className="details">{details}</p>{revealed.includes(job.id)
        ? (target
          ? <a className="contactLink" href={target.href} target="_blank" rel="noopener noreferrer">{target.label}</a>
          : <span className="contactLink">لا توجد وسيلة تواصل في الإعلان</span>)
        : <button className="reveal" onClick={() => setRevealed([...revealed, job.id])}>إظهار وسيلة التواصل</button>}</article>;
    })}</div></section>) : <div className="empty">{notice ?? "لا توجد وظائف مطابقة لهذه الفلاتر."}</div>}</section>
    <section className="about" id="about"><p className="eyebrow">كيف تعمل المنصة؟</p><h2>نبحث، نصنّف، وننشر</h2><div className="steps"><div><b>01</b><h3>متابعة مستمرة</h3><p>نفحص القنوات المختارة تلقائياً كل 5 دقائق.</p></div><div><b>02</b><h3>تصنيف ذكي</h3><p>نستخرج الوظائف العلمية داخل السعودية فقط.</p></div><div><b>03</b><h3>محتوى متجدد</h3><p>تُخفى الوظيفة تلقائياً بعد مرور 30 يوماً.</p></div></div></section>
    <footer><div className="brand"><span className="brandMark"><LabMark /></span><span><b>وظائف العلوم</b><small>Saudi Science Jobs</small></span></div><p>منصة مستقلة لجمع الوظائف العلمية في المملكة العربية السعودية.</p><div className="footerEnd"><span>© 2026</span><Link className="adminLink" href="/admin">دخول الإدارة</Link><div className="footerPrayer"><span>لا تنسونا ووالدينا من دعائكم</span><a href="https://www.tiktok.com/@vlogqueenn" target="_blank" rel="noopener noreferrer"><TikTokIcon /><b dir="ltr">@vlogqueenn</b></a></div></div></footer>
  </main>;
}
