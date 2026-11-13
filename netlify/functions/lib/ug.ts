import type { ImportedSong } from "../../../src/shared/types";

export type ImportErrorCode = "not_ug" | "blocked" | "parse";

export class ImportError extends Error {
  constructor(public code: ImportErrorCode) {
    super(code);
    this.name = "ImportError";
  }
}

const UG_HOSTS = new Set(["tabs.ultimate-guitar.com", "www.ultimate-guitar.com"]);
const MAX_REDIRECTS = 3;
/** Give up on Ultimate Guitar well before the function's own time limit. */
const FETCH_TIMEOUT_MS = 7000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function isUgUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    UG_HOSTS.has(u.hostname) &&
    u.pathname.startsWith("/tab/") &&
    u.pathname.includes("chords")
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  // A plain space keeps chord columns lined up in the monospace sheet.
  nbsp: " ",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", prime: "′", Prime: "″",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  bull: "•", middot: "·", deg: "°", times: "×", divide: "÷",
  copy: "©", reg: "®", trade: "™", iexcl: "¡", iquest: "¿",
  szlig: "ß", aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å",
};
// Accented letters: &eacute; &Ntilde; &uuml; ...
for (const [suffix, base, marks] of [
  ["acute", "aeiouyAEIOUY", "́"],
  ["grave", "aeiouAEIOU", "̀"],
  ["circ", "aeiouAEIOU", "̂"],
  ["uml", "aeiouyAEIOUY", "̈"],
  ["tilde", "anoANO", "̃"],
  ["cedil", "cC", "̧"],
] as const) {
  for (const ch of base) NAMED_ENTITIES[ch + suffix] = (ch + marks).normalize("NFC");
}

/** Decodes HTML character references in one pass, so "&amp;rsquo;" becomes "&rsquo;", not "’". Unknown ones stay. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

export function parseUgHtml(html: string, sourceUrl: string): ImportedSong {
  const m = html.match(/<div[^>]*class="[^"]*\bjs-store\b[^"]*"[^>]*data-content="([^"]*)"/i);
  if (!m) throw new ImportError("parse");
  let data: any;
  try {
    data = JSON.parse(decodeEntities(m[1]));
  } catch {
    throw new ImportError("parse");
  }
  const pageData = data?.store?.page?.data;
  const tab = pageData?.tab;
  const content = pageData?.tab_view?.wiki_tab?.content;
  if (typeof content !== "string" || content.length === 0) throw new ImportError("parse");
  // UG stores some user text with HTML entities still in it (&rsquo; &mdash; ...) and decodes them on display.
  return {
    title: decodeEntities(String(tab?.song_name ?? "")),
    artist: decodeEntities(String(tab?.artist_name ?? "")),
    sourceUrl,
    originalKey: typeof tab?.tonality_name === "string" ? tab.tonality_name : "",
    capo: Number.isFinite(Number(tab?.capo)) ? Number(tab.capo) : 0,
    content: decodeEntities(content),
  };
}

export async function importFromUg(url: string, fetchFn: typeof fetch = fetch): Promise<ImportedSong> {
  if (!isUgUrl(url)) throw new ImportError("not_ug");
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchFn(current, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      // Network failure, abort or timeout.
      throw new ImportError("blocked");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      let next: string;
      try {
        next = new URL(loc ?? "", current).toString();
      } catch {
        throw new ImportError("blocked");
      }
      if (!isUgUrl(next)) throw new ImportError("blocked");
      current = next;
      continue;
    }
    if (res.status !== 200) throw new ImportError("blocked");
    let html: string;
    try {
      html = await res.text();
    } catch {
      // The body stream can also hit the timeout or drop.
      throw new ImportError("blocked");
    }
    return parseUgHtml(html, url);
  }
  throw new ImportError("blocked");
}
