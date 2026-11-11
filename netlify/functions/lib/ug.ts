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

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

export function parseUgHtml(html: string, sourceUrl: string): ImportedSong {
  const m = html.match(/<div[^>]*class="[^"]*\bjs-store\b[^"]*"[^>]*data-content="([^"]*)"/i);
  if (!m) throw new ImportError("parse");
  let data: any;
  try {
    data = JSON.parse(unescapeHtml(m[1]));
  } catch {
    throw new ImportError("parse");
  }
  const pageData = data?.store?.page?.data;
  const tab = pageData?.tab;
  const content = pageData?.tab_view?.wiki_tab?.content;
  if (typeof content !== "string" || content.length === 0) throw new ImportError("parse");
  return {
    title: String(tab?.song_name ?? ""),
    artist: String(tab?.artist_name ?? ""),
    sourceUrl,
    originalKey: typeof tab?.tonality_name === "string" ? tab.tonality_name : "",
    capo: Number.isFinite(Number(tab?.capo)) ? Number(tab.capo) : 0,
    content,
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
      });
    } catch {
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
    return parseUgHtml(await res.text(), url);
  }
  throw new ImportError("blocked");
}
