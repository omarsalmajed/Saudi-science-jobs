/* Pure-logic tests. No network, no keys.  node test/unit.test.mjs  */
import { parsePosts } from "../channel.js";
import { dedupKeys, normaliseAr, normaliseUrl } from "../dedup.js";

const { extractContacts } = await import("../contacts.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const eq = (name, got, want) => ok(name, got === want, `\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* ---------------------------------------------------- phone normalisation */
eq("05xxxxxxxx -> +966", extractContacts("للتواصل 0551234567").phone, "+966551234567");
eq("+966 5xx with spaces", extractContacts("جوال +966 55 123 4567").phone, "+966551234567");
eq("00966 prefix", extractContacts("00966551234567").phone, "+966551234567");
eq("arabic-indic digits", extractContacts("للتواصل ٠٥٥١٢٣٤٥٦٧").phone, "+966551234567");
eq("wa.me link", extractContacts("https://wa.me/966551234567").phone, "+966551234567");
eq("riyadh landline", extractContacts("هاتف 0112345678").phone, "+966112345678");
eq("dammam landline", extractContacts("هاتف 013 812 3456").phone, "+966138123456");
eq("no phone -> null", extractContacts("لا يوجد رقم هنا").phone, null);
eq("random 9-digit id is not a phone", extractContacts("رقم الإعلان 123456789").phone, null);

/* ------------------------------------------------------------------ email */
eq("email", extractContacts("hr@lab-sa.com للتقديم").email, "hr@lab-sa.com");

/* -------------------------------------------------------------- apply url */
eq("bare domain from text",
   extractContacts("للتقديم saudijobs24.com/t185109-topic").apply_url,
   "saudijobs24.com/t185109-topic");
eq("href beats text",
   extractContacts("للتقديم (bit.ly/4wusLaO)", ["http://bit.ly/4wusLaO"]).apply_url,
   "http://bit.ly/4wusLaO");
eq("telegram self-link is not an apply url",
   extractContacts("قناتنا t.me/cd4cd", ["https://t.me/cd4cd"]).apply_url, null);
eq("full url kept",
   extractContacts("https://jadarat.sa/jobs/9931 قدم هنا").apply_url,
   "https://jadarat.sa/jobs/9931");

/* ---------------------------------------------------------------- masking */
const masked = extractContacts("اتصل 0551234567 أو hr@lab.com عبر jadarat.sa/x").masked;
ok("phone removed before the model sees it", !masked.includes("0551234567"), masked);
ok("email removed before the model sees it", !masked.includes("hr@lab.com"), masked);
ok("placeholders inserted", masked.includes("[جوال]") && masked.includes("[بريد]"), masked);

/* ------------------------------------------------------- arabic normalise */
eq("alef variants fold", normaliseAr("أخصائي"), normaliseAr("اخصائي"));
eq("ta marbuta folds", normaliseAr("تقنية"), normaliseAr("تقنيه"));
eq("harakat ignored", normaliseAr("مُختَبَر"), normaliseAr("مختبر"));
eq("emoji and punctuation dropped", normaliseAr("🔬 أخصائي، مختبر!"), "اخصاءي مختبر");

/* ----------------------------------------------------------- url normalise */
eq("scheme and www folded",
   normaliseUrl("https://WWW.Jadarat.sa/jobs/9931/"), normaliseUrl("http://jadarat.sa/jobs/9931"));
eq("tracking params dropped",
   normaliseUrl("https://jadarat.sa/j/1?utm_source=tg&fbclid=z"), "jadarat.sa/j/1");
eq("scheme-less input still normalises", normaliseUrl("bit.ly/4wusLaO"), "bit.ly/4wusLaO");
eq("junk -> null", normaliseUrl("not a url at all "), null);

/* ------------------------------------------------------------ dedup keys */
const a = dedupKeys({ apply_url: "https://jadarat.sa/j/1?utm_source=tg", contact_phone: "+966551234567",
  title: "أخصائي مختبر", employer: "مختبرات علم", city: "الرياض", posted_at: "2026-08-16T09:00:00Z" });
const b = dedupKeys({ apply_url: "http://www.jadarat.sa/j/1/", contact_phone: "+966551234567",
  title: "اخصائي مختبر", employer: "مختبرات علم", city: "الرياض", posted_at: "2026-08-16T21:00:00Z" });
eq("same vacancy, different decoration -> same url key", a.dedup_url, b.dedup_url);
eq("same vacancy -> same contact key", a.dedup_contact, b.dedup_contact);
eq("same vacancy same day -> same fingerprint", a.dedup_fingerprint, b.dedup_fingerprint);

const c = dedupKeys({ apply_url: null, contact_phone: "+966551234567", title: "باحث أحياء",
  employer: "مختبرات علم", city: "الرياض", posted_at: "2026-08-16T09:00:00Z" });
ok("same employer, different role -> different keys",
   c.dedup_contact !== a.dedup_contact && c.dedup_fingerprint !== a.dedup_fingerprint);

const thin = dedupKeys({ apply_url: null, contact_phone: null, contact_email: null,
  title: null, employer: null, city: null, posted_at: "2026-08-16T09:00:00Z" });
ok("a post with no identifying detail produces no keys",
   thin.dedup_url === null && thin.dedup_contact === null && thin.dedup_fingerprint === null);

/* --------------------------------------------------------- html parsing */
const html = `
<div class="tgme_widget_message_wrap"><div data-post="cd4cd/100">
<time datetime="2026-08-16T10:00:00+00:00"></time>
<div class="tgme_widget_message_text js-message_text">مطلوب <b>أخصائي مختبر</b><br/>الرياض
<a href="https://jadarat.sa/j/1">jadarat.sa/j/1</a><a href="https://t.me/cd4cd">قناتنا</a></div>
<a class="tgme_widget_message_photo_wrap x" style="background-image:url('https://cdn.tg/p1.jpg')"></a>
</div></div>`;
const posts = parsePosts(html);
eq("post id parsed", posts[0]?.id, 100);
eq("permalink built", posts[0]?.permalink, "https://t.me/cd4cd/100");
eq("photo url captured", posts[0]?.photos[0], "https://cdn.tg/p1.jpg");
eq("apply href captured", posts[0]?.links[0], "https://jadarat.sa/j/1");
eq("self-link excluded from links", posts[0]?.links.length, 1);
ok("tags stripped from text", !posts[0].text.includes("<b>"), posts[0].text);
eq("line breaks preserved", posts[0].text.includes("\n"), true);

/* -------------------------------------------------- regression guards */
const multi = extractContacts("جوال 0551234567 وأيضاً 0509876543 وهاتف 0138123456").masked;
ok("every number in a post is masked, not just the first",
   !/\d{7}/.test(multi), multi);

ok("case-sensitive short links stay distinct",
   normaliseUrl("bit.ly/aB9xQ") !== normaliseUrl("bit.ly/Ab9Xq"));

eq("khobar landline grouped 013-812-3456",
   extractContacts("هاتف 013-812-3456").phone, "+966138123456");
eq("advert reference number is not a landline",
   extractContacts("رقم الإعلان 123456789 في الرياض").phone, null);

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
