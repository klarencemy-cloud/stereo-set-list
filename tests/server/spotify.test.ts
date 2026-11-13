import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { importPlaylist, parseSpotifyEmbedHtml, playlistIdFrom, PlaylistError } from "../../netlify/functions/lib/spotify";
import handler from "../../netlify/functions/playlist";

const fixture = readFileSync("tests/fixtures/spotify-embed.html", "utf8");
const ID = "37i9dQZF1DX4UtSsGT1Sbe";

/** The fixture's page data, for building variations of it. */
function fixtureData() {
  const m = fixture.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)!;
  return JSON.parse(m[1]);
}
const pageWith = (data: unknown) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof PlaylistError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
};

describe("playlistIdFrom", () => {
  it("accepts playlist links and URIs", () => {
    expect(playlistIdFrom(`https://open.spotify.com/playlist/${ID}?si=abc`)).toBe(ID);
    expect(playlistIdFrom(`https://open.spotify.com/intl-de/playlist/${ID}`)).toBe(ID);
    expect(playlistIdFrom(`  https://open.spotify.com/embed/playlist/${ID}  `)).toBe(ID);
    expect(playlistIdFrom(`spotify:playlist:${ID}`)).toBe(ID);
  });
  it("rejects anything else", () => {
    expect(playlistIdFrom(`https://open.spotify.com/album/${ID}`)).toBeNull();
    expect(playlistIdFrom(`https://open.spotify.com.evil.com/playlist/${ID}`)).toBeNull();
    expect(playlistIdFrom(`http://open.spotify.com/playlist/${ID}`)).toBeNull();
    expect(playlistIdFrom("https://open.spotify.com/playlist/../../x")).toBeNull();
    expect(playlistIdFrom("http://example.com")).toBeNull();
    expect(playlistIdFrom("not a url")).toBeNull();
  });
});

describe("parseSpotifyEmbedHtml", () => {
  it("reads the playlist name and its tracks in order", () => {
    expect(parseSpotifyEmbedHtml(fixture)).toEqual({
      name: "Friday Rehearsal",
      tracks: [
        { title: "Garden Path Song", artist: "The Made Up Band" },
        { title: "Café & Rain", artist: "Nowhere Trio, Guest Singer" },
        { title: "Lighthouse - Live", artist: "The Made Up Band" },
      ],
      truncated: false,
    });
  });

  it("says when the page is full, since Spotify may have left tracks out", () => {
    const data = fixtureData();
    const entity = data.props.pageProps.state.data.entity;
    entity.trackList = Array.from({ length: 100 }, (_, i) => ({ ...entity.trackList[0], title: `Song ${i}` }));
    const out = parseSpotifyEmbedHtml(pageWith(data));
    expect(out.tracks).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  it("skips tracks with no title", () => {
    const data = fixtureData();
    data.props.pageProps.state.data.entity.trackList[0].title = "  ";
    expect(parseSpotifyEmbedHtml(pageWith(data)).tracks).toHaveLength(2);
  });

  it("fails to parse a page with no playlist on it", () => {
    expect(codeOf(() => parseSpotifyEmbedHtml("<html>nothing</html>"))).toBe("parse");
    expect(codeOf(() => parseSpotifyEmbedHtml(pageWith({ props: { pageProps: { state: { data: {} } } } })))).toBe("parse");
    expect(codeOf(() => parseSpotifyEmbedHtml('<script id="__NEXT_DATA__" type="application/json">{oops</script>'))).toBe(
      "parse",
    );
  });

  it("reports an empty playlist", () => {
    const data = fixtureData();
    data.props.pageProps.state.data.entity.trackList = [];
    expect(codeOf(() => parseSpotifyEmbedHtml(pageWith(data)))).toBe("empty");
  });
});

describe("importPlaylist", () => {
  const ok = () => new Response(fixture, { status: 200 });

  it("fetches the public embed page for the playlist", async () => {
    const fetchFn = vi.fn(async () => ok());
    const out = await importPlaylist(`https://open.spotify.com/playlist/${ID}?si=x`, fetchFn as unknown as typeof fetch);
    expect(out.tracks).toHaveLength(3);
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe(`https://open.spotify.com/embed/playlist/${ID}`);
  });

  it("refuses a link that is not a Spotify playlist without fetching", async () => {
    const fetchFn = vi.fn();
    await expect(importPlaylist("https://example.com/x", fetchFn)).rejects.toMatchObject({ code: "not_spotify" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports blocked when Spotify refuses or can't be reached", async () => {
    for (const fetchFn of [
      vi.fn(async () => new Response("no", { status: 403 })),
      vi.fn(async () => new Response("slow down", { status: 429 })),
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    ]) {
      await expect(importPlaylist(`spotify:playlist:${ID}`, fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
        code: "blocked",
      });
    }
  });
});

describe("POST /api/playlist", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("explains a link that is not a Spotify playlist", async () => {
    const res = await handler(post({ url: "https://example.com" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: "not_spotify", message: "That link isn't a Spotify playlist" });
  });

  it("only takes POST", async () => {
    const res = await handler(new Request("http://localhost/api/playlist"));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ code: "method", message: "Method not allowed" });
  });
});
