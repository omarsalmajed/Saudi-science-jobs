/* Pulls phone numbers, emails and application links out of a post before the
 * text ever reaches the model, so a contact detail can never end up buried in
 * a free-text field like `notes` — and so the model spends no tokens on them.
 */

// Numbers are pulled out before the text reaches the model, so they can never
// end up buried inside a free-text field like `notes`.

const AR_DIGITS = /[\u0660-\u0669]/g;
const toLatin = t => t.replace(AR_DIGITS, c => String(c.charCodeAt(0) - 0x0660));

// Anchored on a country code or a leading zero. Without that anchor a bare
// "123456789" advert reference number parses as a Riyadh landline.
const PHONE_RE = /(?:(?:\+?966|00966)[\s\-]?|0)5(?:[\s\-]?\d){8}/;
// Real posts often give only a landline: 011/012/013/014/016/017 + 7 digits.
// Without this those ads reach the board with no way to contact them.
// Area code + 7 digits, grouped however the poster felt like grouping it:
// 0138123456, 013 812 3456, 013-812-3456 all have to land.
const LAND_RE = /(?:(?:\+?966|00966)[\s\-]?|0)1[1-7](?:[\s\-]?\d){7}/;
const EMAIL_RE = /[\w.\-]+@[\w.\-]+\.\w+/;
const WA_RE = /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d+)/i;
// Many ads apply only through a portal (jadarat.sa, company sites, bit.ly)
// with no phone or email at all. Telegram strips the scheme from the visible
// text, so this has to match bare domains too.
const URL_RE = /(?:https?:\/\/)?(?!t\.me|telegram\.)(?:[\w-]+\.)+(?:com|net|org|sa|io|co|me|app|ly|info|gov)(?:\/[^\s)»"']*)?/i;

/** Same pattern, global, for masking. */
const g = re => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");

function normalisePhone(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966")) d = d.slice(3);
  else if (d.startsWith("05")) d = d.slice(1);
  return d.length === 9 && d.startsWith("5") ? "+966" + d : null;
}

function normaliseLandline(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length === 9 && /^1[1-7]/.test(d) ? "+966" + d : null;
}

export function extractContacts(text, hrefs = []) {
  const t = toLatin(text);
  const wa = t.match(WA_RE);
  const ph = t.match(PHONE_RE);
  const ln = t.match(LAND_RE);
  const em = t.match(EMAIL_RE);
  const inText = t.match(URL_RE);
  // An href from the post markup beats anything scraped out of the text: the
  // rendered text shows "bit.ly/4wusLaO" while the href carries the scheme.
  const href = hrefs.find(u => !/^https?:\/\/(t\.me|telegram\.)/i.test(u));

  return {
    phone: (wa && normalisePhone(wa[1]))
        || (ph && normalisePhone(ph[0]))
        || (ln && normaliseLandline(ln[0]))
        || null,
    email: em ? em[0] : null,
    apply_url: href || (inText ? inText[0] : null),
    // Global: an ad listing three numbers must have all three removed, not
    // just the first, or the leftovers reach the model and land in `notes`.
    masked: t.replace(g(WA_RE), "[واتساب]")
             .replace(g(PHONE_RE), "[جوال]")
             .replace(g(LAND_RE), "[هاتف]")
             .replace(g(EMAIL_RE), "[بريد]")
             .replace(g(URL_RE), "[رابط]"),
  };
}

