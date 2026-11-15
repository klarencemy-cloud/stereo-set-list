import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ImportError, importFromUg, isUgUrl, parseUgHtml } from "../../netlify/functions/lib/ug";
import handler from "../../netlify/functions/import";

const URL_OK = "https://tabs.ultimate-guitar.com/tab/the-made-up-band/garden-path-song-chords-123";
const fixture = readFileSync("tests/fixtures/ug-chords.html", "utf8");

const res = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("isUgUrl", () => {
  it("accepts chords pages on UG hosts", () => {
    expect(isUgUrl(URL_OK)).toBe(true);
    expect(isUgUrl("https://www.ultimate-guitar.com/tab/x/y-chords-1")).toBe(true);
  });
  it("rejects other hosts, schemes, and non-chords pages", () => {
    expect(isUgUrl("https://example.com/tab/x-chords-1")).toBe(false);
    expect(isUgUrl("http://tabs.ultimate-guitar.com/tab/x/y-chords-1")).toBe(false);
    expect(isUgUrl("https://tabs.ultimate-guitar.com/tab/x/y-tabs-123")).toBe(false);
    expect(isUgUrl("https://tabs.ultimate-guitar.com.evil.com/tab/x/y-chords-1")).toBe(false);
    expect(isUgUrl("not a url")).toBe(false);
  });
});

describe("parseUgHtml", () => {
  it("reads the song from the js-store div", () => {
    const song = parseUgHtml(fixture, URL_OK);
    expect(song.title).toBe("Garden Path Song");
    expect(song.artist).toBe("The Made Up Band");
    expect(song.originalKey).toBe("G");
    expect(song.capo).toBe(0);
    expect(song.sourceUrl).toBe(URL_OK);
    expect(song.content.startsWith("[Intro]")).toBe(true);
  });
  it("decodes HTML entities UG leaves in the song text", () => {
    // UG's JSON holds "don&rsquo;t"; in the attribute that becomes "don&amp;rsquo;t".
    const data = {
      store: {
        page: {
          data: {
            tab: { song_name: "Caf&eacute; Song", artist_name: "IV OF SPADES", tonality_name: "Gm", capo: 0 },
            tab_view: {
              wiki_tab: {
                content:
                  "I don&rsquo;t\n&lsquo;Cause ba&mdash;-by &ldquo;hi&rdquo;&hellip; &amp;rsquo; &#8217; &#x2019; &bogus; R&amp;B",
              },
            },
          },
        },
      },
    };
    const attr = JSON.stringify(data).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const song = parseUgHtml(`<div class="js-store" data-content="${attr}"></div>`, URL_OK);
    expect(song.title).toBe("Café Song");
    expect(song.content).toBe("I don’t\n‘Cause ba—-by “hi”… &rsquo; ’ ’ &bogus; R&B");
  });
  it("throws parse when the store is missing", () => {
    expect(() => parseUgHtml("<html></html>", URL_OK)).toThrowError(ImportError);
  });
});

describe("importFromUg", () => {
  it("rejects bad URLs before fetching", async () => {
    for (const u of ["https://example.com/tab/x-chords-1", "https://tabs.ultimate-guitar.com/tab/x/y-tabs-123"]) {
      const spy = vi.fn();
      await expect(importFromUg(u, spy as unknown as typeof fetch)).rejects.toMatchObject({ code: "not_ug" });
      expect(spy).not.toHaveBeenCalled();
    }
  });
  it("maps non-200 to blocked", async () => {
    const f = vi.fn(async () => res(403, "no"));
    await expect(importFromUg(URL_OK, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });
  it("maps a redirect off UG hosts to blocked without following it", async () => {
    const f = vi.fn(async () => res(302, "", { location: "https://evil.example.com/x" }));
    await expect(importFromUg(URL_OK, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("follows a redirect to another UG chords URL", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(301, "", { location: "https://www.ultimate-guitar.com/tab/a/b-chords-9" }))
      .mockResolvedValueOnce(res(200, fixture));
    const song = await importFromUg(URL_OK, f as unknown as typeof fetch);
    expect(song.title).toBe("Garden Path Song");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("maps an aborted or timed-out fetch to blocked", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(importFromUg(URL_OK, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });
  it("passes a timeout signal to every upstream fetch", async () => {
    const f = vi
      .fn(async (_u: string, _i?: RequestInit) => res(200, fixture))
      .mockResolvedValueOnce(res(301, "", { location: "https://www.ultimate-guitar.com/tab/a/b-chords-9" }));
    await importFromUg(URL_OK, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [, init] of f.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("maps a body that fails to read to blocked", async () => {
    const broken = new Response(
      new ReadableStream({
        start(c) {
          c.error(new DOMException("timed out", "TimeoutError"));
        },
      }),
      { status: 200 },
    );
    const f = vi.fn(async () => broken);
    await expect(importFromUg(URL_OK, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });
  it("maps unparseable pages to parse", async () => {
    const f = vi.fn(async () => res(200, "<html></html>"));
    await expect(importFromUg(URL_OK, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "parse" });
  });
  it("sends a browser User-Agent and returns the song", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => res(200, fixture));
    const song = await importFromUg(URL_OK, f as unknown as typeof fetch);
    expect(song.title).toBe("Garden Path Song");
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/Mozilla/);
    expect(init.redirect).toBe("manual");
  });
});

describe("POST /api/import", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("explains a link that is not a UG chords page", async () => {
    const res = await handler(post({ url: "https://example.com" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: "not_ug", message: "That link isn't an Ultimate Guitar chords page" });
  });

  it("only takes POST", async () => {
    const res = await handler(new Request("http://localhost/api/import"));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ code: "method", message: "Method not allowed" });
  });
});
