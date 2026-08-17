"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { EMPLOYMENT_TYPES, SPECIALTIES } from "@/lib/job-shared";

const specialties = SPECIALTIES;

export default function Submit() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);

    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const r = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({ ok: false }));
      if (r.ok && data.ok) setSent(true);
      else setError(data.error ?? "تعذّر إرسال الطلب. حاول لاحقاً.");
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقق من الشبكة وحاول مجدداً.");
    } finally {
      setBusy(false);
    }
  }

  return <main dir="rtl" className="innerPage"><header className="topbar"><Link className="brand" href="/"><span className="brandMark">س</span><span><b>وظائف العلوم</b><small>Saudi Science Jobs</small></span></Link><nav><Link href="/">الوظائف</Link></nav></header>
    <section className="pageHero"><p className="eyebrow">لجهات العمل</p><h1>أضف وظيفة علمية</h1><p>أرسل تفاصيل الشاغر، وسيظهر بعد مراجعته للتأكد من وضوح البيانات.</p></section>
    <form className="formPanel" onSubmit={submit}>{sent ? <div className="success"><b>تم استلام الوظيفة</b><p>ستُنشر بعد المراجعة. شكراً لمساهمتك.</p><Link href="/">العودة للوظائف</Link></div> : <>
      <div className="formGrid"><label>جهة العمل *<input name="employer" required placeholder="اسم الشركة أو المختبر" /></label><label>المدينة *<input name="city" required placeholder="مثال: الرياض" /></label><label>المسمى الوظيفي *<input name="title" required placeholder="مثال: أخصائي أحياء دقيقة" /></label><label>التخصص *<select name="specialty" required defaultValue=""><option value="" disabled>اختر التخصص</option>{specialties.map(s => <option key={s}>{s}</option>)}</select></label><label>نوع الدوام<select name="employment_type" defaultValue={EMPLOYMENT_TYPES[0]}>{EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label><label>وسيلة التقديم *<input name="contact" required placeholder="رابط، بريد إلكتروني، أو رقم جوال" /></label><label className="wide">تفاصيل إضافية<textarea name="notes" rows={5} placeholder="المتطلبات، الخبرة، الراتب إن وجد..." /></label></div>
      {/* Honeypot: hidden from people, irresistible to bots. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
      {error ? <p style={{ color: "#b3261e", fontSize: 13, marginTop: 18 }}>{error}</p> : null}
      <button className="primary" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال..." : "إرسال للمراجعة"}</button></>}</form></main>;
}
