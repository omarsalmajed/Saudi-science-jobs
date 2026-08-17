/* Reads a PUBLIC Telegram channel through its open web preview at
 * https://t.me/s/<username>. No bot token, no API keys, no login, no phone.
 *
 * Telegram renders the preview as plain server-side HTML, so a single GET
 * gives us post id, timestamp, text, photo URLs and forward attribution.
 * Older pages are reached with ?before=<id>, ~20 posts per page.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Strip tags to plain text, keeping <br> and block breaks as newlines. */
function detag(html) {
  const named = {
    nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&",
    // Bidi marks: Telegram emits these constantly in Arabic posts. They carry
    // no meaning for us and wreck length checks if left as literal "&rlm;".
    rlm: "", lrm: "", zwnj: "", zwj: "",
    hellip: "…", mdash: "—", ndash: "–", middot: "·",
  };
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Numeric entities first, then named, then a bare &amp; last.
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(\w+);/g, (m, n) => (n in named ? named[n] : m))
    // Bidi control characters themselves, once decoded.
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One page of the preview. `before` pages backwards through history. */
export async function fetchPage(username, before) {
  const url = `https://t.me/s/${encodeURIComponent(username)}` +
              (before ? `?before=${before}` : "");
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`t.me/s/${username} -> HTTP ${r.status}`);
  const html = await r.text();
  // Telegram 302s to the plain profile page when a channel is private or has
  // its web preview switched off — that page carries no message markup.
  if (!html.includes("tgme_widget_message_wrap")) {
    throw new Error(
      `no posts in preview for @${username} — is the channel public?`);
  }
  return html;
}

/** Split a preview page into structured posts, oldest first. */
export function parsePosts(html) {
  const chunks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  const posts = [];

  for (const c of chunks) {
    const idM = c.match(/data-post="([^"]+)\/(\d+)"/);
    if (!idM) continue;

    const dateM = c.match(/<time[^>]+datetime="([^"]+)"/);
    const textM = c.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);

    // Photos are CSS backgrounds on the wrap anchor; the CDN needs no auth.
    const photos = [...c.matchAll(
      /tgme_widget_message_photo_wrap[^"]*"[^>]*background-image:url\('([^']+)'/g)
    ].map(m => m[1]);

    // Real posts write the apply link as "للتقديم (saudijobs24.com/t185109)".
    // Telegram drops the scheme from the visible text, so the plain-text pass
    // cannot recover a usable URL — the href can.
    const links = textM
      ? [...textM[1].matchAll(/<a href="([^"]+)"/g)]
          .map(m => m[1])
          .filter(u => !/^https?:\/\/(t\.me|telegram\.)/i.test(u))
      : [];

    // If the post was forwarded, keep a link back to the original message.
    const fwdM = c.match(
      /tgme_widget_message_forwarded_from_name"\s+href="([^"]+)"/);

    posts.push({
      channel: idM[1],
      id: Number(idM[2]),
      permalink: `https://t.me/${idM[1]}/${idM[2]}`,
      source_link: fwdM ? fwdM[1] : null,
      posted_at: dateM ? dateM[1] : null,
      text: textM ? detag(textM[1]) : "",
      photos,
      links,
    });
  }
  return posts.sort((a, b) => a.id - b.id);
}

/** Walk back through history.
 *  Stops at `stopAfterId`, at `sinceDate`, after `maxPages`, or at the top.
 *  `sinceDate` is what makes a "last 30 days" backfill exact rather than a
 *  guess at how many pages 30 days happens to be — these channels post at
 *  very different rates. */
export async function collect(
  username, { stopAfterId = 0, maxPages = 1, sinceDate = null } = {}
) {
  const seen = new Map();
  const floor = sinceDate ? new Date(sinceDate).getTime() : null;
  let before = undefined;
  let pagesRead = 0;

  for (let page = 0; page < maxPages; page++) {
    const batch = parsePosts(await fetchPage(username, before));
    pagesRead++;
    if (!batch.length) break;

    for (const p of batch) {
      if (p.id <= stopAfterId) continue;
      if (floor && p.posted_at && new Date(p.posted_at).getTime() < floor) continue;
      seen.set(p.id, p);
    }

    const oldest = batch[0];
    // The whole page predates the window; nothing older can qualify.
    if (floor && oldest.posted_at && new Date(oldest.posted_at).getTime() < floor) break;
    if (oldest.id <= stopAfterId + 1) break;   // reached what we already have
    if (before === oldest.id) break;           // no movement, we are at the top
    before = oldest.id;

    // t.me serves these pages ungrudgingly, but a backfill can ask for 40 of
    // them in a row; stay polite.
    if (page + 1 < maxPages) await new Promise(r => setTimeout(r, 400));
  }
  const posts = [...seen.values()].sort((a, b) => a.id - b.id);
  posts.pagesRead = pagesRead;
  return posts;
}

/** Download a photo and hand it back as base64 for the vision model. */
export async function fetchImage(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4_500_000) throw new Error("image too large");
  const type = r.headers.get("content-type") || "image/jpeg";
  return { base64: buf.toString("base64"), mediaType: type.split(";")[0] };
}
