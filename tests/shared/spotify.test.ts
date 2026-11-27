import { describe, expect, it } from "vitest";
import { spotifyEmbedUrl, spotifyTrackIdFrom, spotifyTrackUrl } from "../../src/shared/spotify";

const ID = "4uLU6hMCjMI75M1A2tKUQC";

describe("spotifyTrackIdFrom", () => {
  it("accepts a Spotify track link in the forms Spotify shares", () => {
    for (const link of [
      `https://open.spotify.com/track/${ID}`,
      `https://open.spotify.com/track/${ID}?si=1a2b3c4d5e`,
      `https://open.spotify.com/intl-de/track/${ID}`,
      `https://open.spotify.com/intl-pt-br/track/${ID}/`,
      `https://open.spotify.com/embed/track/${ID}`,
      `  https://open.spotify.com/track/${ID}  `,
      `spotify:track:${ID}`,
    ]) {
      expect(spotifyTrackIdFrom(link), link).toBe(ID);
    }
  });

  it("rejects albums, playlists, artists, other sites and look-alike hosts", () => {
    for (const link of [
      `https://open.spotify.com/album/${ID}`,
      `https://open.spotify.com/playlist/${ID}`,
      `https://open.spotify.com/artist/${ID}`,
      `spotify:album:${ID}`,
      `http://open.spotify.com/track/${ID}`,
      `https://open.spotify.com.evil.com/track/${ID}`,
      `https://www.youtube.com/watch?v=${ID}`,
      "https://open.spotify.com/track/short",
      `https://open.spotify.com/track/${ID}/extra`,
      "not a link",
      "",
    ]) {
      expect(spotifyTrackIdFrom(link), link).toBeNull();
    }
  });
});

describe("Spotify addresses", () => {
  it("builds the track page and the embedded player for a track", () => {
    expect(spotifyTrackUrl(ID)).toBe(`https://open.spotify.com/track/${ID}`);
    expect(spotifyEmbedUrl(ID)).toBe(`https://open.spotify.com/embed/track/${ID}`);
  });
});
