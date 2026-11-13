import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getSong: vi.fn(), updateSong: vi.fn(), getGig: vi.fn(), listSongs: vi.fn(), getTrack: vi.fn(), getTrackPart: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import SongPage from "../../src/app/pages/SongPage";
import { clearSongCache, peekSong } from "../../src/app/songCache";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const song = {
  id: "s1",
  title: "Test Song",
  artist: "The Band",
  sourceUrl: null,
  originalKey: "G",
  bandKey: "A",
  capo: 0,
  content: "[Intro]\n[ch]G[/ch] [ch]C[/ch]\nla la",
  updatedAt: "x",
};

function renderPage(path = "/songs/s1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/songs/:id" element={<SongPage />} />
        <Route path="/songs/:id/edit" element={<div>edit page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  document.body.className = "";
  localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  clearSongCache();
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.getSong.mockResolvedValue({ ...song });
});

describe("SongPage", () => {
  it("shows chords in the band key and the key line", async () => {
    renderPage();
    expect((await screen.findByText("No capo")).parentElement).toHaveTextContent("Key: A");
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["A", "D"]);
    expect(screen.getByText("No capo")).toBeInTheDocument();
  });

  it("renders a section label on its own line", async () => {
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.getByText("[Intro]")).toBeInTheDocument();
  });

  it("transposes up, saves the new key and updates the chords", async () => {
    mocked.updateSong.mockResolvedValue({ ...song, bandKey: "Bb" });
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    // Sends the version it loaded, so a bandmate's newer key isn't overwritten.
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bandKey: "Bb" }, "x");
    await waitFor(() => {
      const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
      expect(chords).toEqual(["Bb", "Eb"]);
    });
    expect(screen.getByText("Changes the key for the whole band.")).toBeInTheDocument();
  });

  it("reverts the key and shows an error when saving fails", async () => {
    mocked.updateSong.mockRejectedValue(new ApiError(500, "Could not save"));
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["A", "D"]);
  });

  it("sends the new version with the next transpose", async () => {
    mocked.updateSong.mockResolvedValueOnce({ ...song, bandKey: "Bb", updatedAt: "y" });
    mocked.updateSong.mockResolvedValueOnce({ ...song, bandKey: "B", updatedAt: "z" });
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Transpose up" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(2));
    expect(mocked.updateSong.mock.calls[1]).toEqual(["s1", { bandKey: "B" }, "y"]);
  });

  it("on a conflict, keeps the old key, says someone else changed it, and Reload shows their version", async () => {
    const theirs = { ...song, bandKey: "C", updatedAt: "y" };
    mocked.updateSong.mockRejectedValue(new ApiError(409, "Someone else changed this song. Reload to see their changes.", theirs));
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this song");
    let chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["A", "D"]);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.queryByRole("alert")).toBeNull();
    chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["C", "F"]);
    expect(peekSong("s1")).toEqual(theirs);
  });

  it("disables the transpose buttons while a save is pending", async () => {
    let resolve!: (v: unknown) => void;
    mocked.updateSong.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(screen.getByRole("button", { name: "Transpose up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transpose down" })).toBeDisabled();
    resolve({ ...song, bandKey: "Bb" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Transpose up" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Transpose down" })).toBeEnabled();
    expect(mocked.updateSong).toHaveBeenCalledTimes(1);
  });

  it("cycles the speed", async () => {
    renderPage();
    const btn = await screen.findByRole("button", { name: /Speed: 1$/ });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Speed: 1.5" })).toBeInTheDocument();
  });

  it("starts at the speed saved for this song on this device", async () => {
    localStorage.setItem("stereo-set:scroll-speed:s1", "2");
    renderPage();
    expect(await screen.findByRole("button", { name: "Speed: 2" })).toBeInTheDocument();
  });

  it("remembers a changed speed for the next visit", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Speed: 1" }));
    expect(localStorage.getItem("stereo-set:scroll-speed:s1")).toBe("1.5");
  });

  it("shows the next song's own speed after moving to it (the page is reused)", async () => {
    localStorage.setItem("stereo-set:scroll-speed:s1", "3");
    localStorage.setItem("stereo-set:scroll-speed:sC", "0.5");
    mocked.getGig.mockResolvedValue({ id: "g1", name: "Show", date: "2026-12-20", songIds: ["s1", "sC", "sD"] });
    mocked.listSongs.mockResolvedValue(["s1", "sC", "sD"].map((id) => ({ ...song, id, content: undefined })));
    mocked.getSong.mockImplementation(async (id: string) =>
      id === "s1" ? { ...song } : { ...song, id, title: `Song ${id}` },
    );
    renderPage("/songs/s1?gig=g1");
    expect(await screen.findByRole("button", { name: "Speed: 3" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
    await screen.findByRole("heading", { name: "Song sC" });
    expect(screen.getByRole("button", { name: "Speed: 0.5" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
    await screen.findByRole("heading", { name: "Song sD" });
    expect(screen.getByRole("button", { name: "Speed: 1" })).toBeInTheDocument();
  });

  it("has a Stage toggle that adds the stage class, with an Exit stage button", async () => {
    renderPage();
    const stage = await screen.findByRole("button", { name: "Stage" });
    expect(stage).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Exit stage" })).not.toBeInTheDocument();
    fireEvent.click(stage);
    expect(document.body.classList.contains("stage")).toBe(true);
    expect(screen.getByRole("button", { name: "Stage" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Exit stage" }));
    expect(document.body.classList.contains("stage")).toBe(false);
    expect(screen.queryByRole("button", { name: "Exit stage" })).not.toBeInTheDocument();
  });

  it("stays in stage mode while moving to the next song in the gig", async () => {
    mocked.getGig.mockResolvedValue({ id: "g1", name: "Show", date: "2026-12-20", songIds: ["s1", "sC"] });
    mocked.listSongs.mockResolvedValue(["s1", "sC"].map((id) => ({ ...song, id, content: undefined })));
    mocked.getSong.mockImplementation(async (id: string) =>
      id === "s1" ? { ...song } : { ...song, id, title: `Song ${id}` },
    );
    renderPage("/songs/s1?gig=g1");
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));
    fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
    await screen.findByRole("heading", { name: "Song sC" });
    expect(document.body.classList.contains("stage")).toBe(true);
    expect(screen.getByRole("button", { name: "Exit stage" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Exit stage" }));
    expect(document.body.classList.contains("stage")).toBe(false);
  });

  it("shows the untransposed sheet and a note when the key is unknown", async () => {
    mocked.getSong.mockResolvedValue({ ...song, originalKey: "H", bandKey: "A" });
    renderPage();
    expect(await screen.findByText("Key unknown \u2014 fix it in Edit")).toBeInTheDocument();
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["G", "C"]);
  });

  it("shows a ? for the key, and the note, when the song has no key yet", async () => {
    mocked.getSong.mockResolvedValue({ ...song, originalKey: "", bandKey: "", trackId: "t1" });
    renderPage();
    expect((await screen.findByText("No capo")).parentElement).toHaveTextContent("Key: ?");
    expect(screen.getByText("Key unknown — fix it in Edit")).toBeInTheDocument();
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["G", "C"]);
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    expect(document.querySelector(".transpose-key")).toHaveTextContent("?");
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/key/i);
    expect(mocked.updateSong).not.toHaveBeenCalled();
  });

  it("shows an error instead of crashing when transposing an unknown key", async () => {
    mocked.getSong.mockResolvedValue({ ...song, originalKey: "H", bandKey: "H" });
    renderPage();
    await screen.findByText("Key unknown \u2014 fix it in Edit");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/key/i);
    expect(mocked.updateSong).not.toHaveBeenCalled();
  });

  it("shows a Source link that opens in a new tab when the song has one", async () => {
    const url = "https://tabs.ultimate-guitar.com/tab/x/y-chords-1";
    mocked.getSong.mockResolvedValue({ ...song, sourceUrl: url });
    renderPage();
    const link = await screen.findByRole("link", { name: "Source" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("has no Source link without a source URL or with a non-web URL", async () => {
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.queryByRole("link", { name: "Source" })).not.toBeInTheDocument();
    cleanup();
    mocked.getSong.mockResolvedValue({ ...song, sourceUrl: "javascript:alert(1)" });
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.queryByRole("link", { name: "Source" })).not.toBeInTheDocument();
  });

  describe("setlist navigation", () => {
    const summary = (id: string) => ({ ...song, id, content: undefined });
    beforeEach(() => {
      mocked.getGig.mockResolvedValue({ id: "g1", name: "Show", date: "2026-12-20", songIds: ["sA", "s1", "gone", "sC"] });
      mocked.listSongs.mockResolvedValue([summary("sA"), summary("s1"), summary("sC")]);
      mocked.getSong.mockImplementation(async (id: string) =>
        id === "s1" ? { ...song } : { ...song, id, title: `Song ${id}` },
      );
    });

    it("shows the setlist note for the song, only on that song", async () => {
      mocked.getGig.mockResolvedValue({
        id: "g1",
        name: "Show",
        date: "2026-12-20",
        songIds: ["sA", "s1", "sC"],
        setlist: [
          { type: "song", songId: "sA" },
          { type: "song", songId: "s1", note: "Klarence count-in" },
          { type: "break", id: "k", label: "Set 2" },
          { type: "song", songId: "sC" },
        ],
      });
      renderPage("/songs/s1?gig=g1");
      expect(await screen.findByRole("note")).toHaveTextContent("Klarence count-in");
      fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
      await screen.findByRole("heading", { name: "Song sC" });
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("shows no note when the gig has none", async () => {
      renderPage("/songs/s1?gig=g1");
      await screen.findByRole("link", { name: /Next song/ });
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("prefetches the next and previous songs in the setlist", async () => {
      renderPage("/songs/s1?gig=g1");
      await screen.findByRole("link", { name: /Next song/ });
      await waitFor(() => expect(mocked.getSong).toHaveBeenCalledWith("sC"));
      expect(mocked.getSong).toHaveBeenCalledWith("sA");
    });

    it("opens the next song without a loading screen", async () => {
      renderPage("/songs/s1?gig=g1");
      const next = await screen.findByRole("link", { name: /Next song/ });
      await waitFor(() => expect(peekSong("sC")).toBeDefined());
      fireEvent.click(next);
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Song sC" })).toBeInTheDocument();
    });

    it("loads the setlist once while moving through the gig", async () => {
      renderPage("/songs/s1?gig=g1");
      fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
      await screen.findByRole("heading", { name: "Song sC" });
      expect(await screen.findByRole("link", { name: /Previous song/ })).toHaveAttribute("href", "/songs/s1?gig=g1");
      expect(mocked.getGig).toHaveBeenCalledTimes(1);
      expect(mocked.listSongs).toHaveBeenCalledTimes(1);
    });

    it("swiping left on the sheet opens the next song, right goes back", async () => {
      renderPage("/songs/s1?gig=g1");
      await screen.findByRole("link", { name: /Next song/ });
      const sheet = screen.getByTestId("sheet");
      fireEvent.touchStart(sheet, { touches: [{ clientX: 300, clientY: 100 }] });
      fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 180, clientY: 105 }] });
      expect(await screen.findByRole("heading", { name: "Song sC" })).toBeInTheDocument();
      await screen.findByRole("link", { name: /Previous song/ });
      const next = screen.getByTestId("sheet");
      fireEvent.touchStart(next, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchEnd(next, { changedTouches: [{ clientX: 220, clientY: 100 }] });
      expect(await screen.findByRole("heading", { name: "Test Song" })).toBeInTheDocument();
    });

    it("swiping does nothing outside a gig", async () => {
      renderPage("/songs/s1");
      await screen.findByText("[Intro]");
      const sheet = screen.getByTestId("sheet");
      fireEvent.touchStart(sheet, { touches: [{ clientX: 300, clientY: 100 }] });
      fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 180, clientY: 100 }] });
      expect(screen.getByRole("heading", { name: "Test Song" })).toBeInTheDocument();
      expect(mocked.getSong).toHaveBeenCalledTimes(1);
    });

    it("transposing updates the cached song", async () => {
      mocked.updateSong.mockResolvedValue({ ...song, bandKey: "Bb" });
      renderPage("/songs/s1?gig=g1");
      await screen.findByText("[Intro]");
      fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
      fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Transpose up" })).toBeEnabled());
      fireEvent.click(await screen.findByRole("link", { name: /Next song/ }));
      await screen.findByRole("heading", { name: "Song sC" });
      fireEvent.click(await screen.findByRole("link", { name: /Previous song/ }));
      expect(await screen.findByText("No capo")).toBeInTheDocument();
      expect(screen.getByText("No capo").parentElement).toHaveTextContent("Key: Bb");
      expect(mocked.getSong.mock.calls.filter(([id]) => id === "s1")).toHaveLength(1);
    });

    it("links to the previous and next song in the gig, keeping the gig", async () => {
      renderPage("/songs/s1?gig=g1");
      const prev = await screen.findByRole("link", { name: /Previous song/ });
      const next = screen.getByRole("link", { name: /Next song/ });
      expect(prev).toHaveAttribute("href", "/songs/sA?gig=g1");
      // "gone" no longer exists, so it is skipped.
      expect(next).toHaveAttribute("href", "/songs/sC?gig=g1");
    });

    it("has no Previous button on the first song and no Next on the last", async () => {
      renderPage("/songs/sA?gig=g1");
      await screen.findByRole("link", { name: /Next song/ });
      expect(screen.queryByRole("link", { name: /Previous song/ })).not.toBeInTheDocument();
      cleanup();
      renderPage("/songs/sC?gig=g1");
      await screen.findByRole("link", { name: /Previous song/ });
      expect(screen.queryByRole("link", { name: /Next song/ })).not.toBeInTheDocument();
    });

    it("shows no buttons when opened outside a gig, and does not fetch gigs", async () => {
      renderPage("/songs/s1");
      await screen.findByText("[Intro]");
      expect(screen.queryByRole("link", { name: /Previous song|Next song/ })).not.toBeInTheDocument();
      expect(mocked.getGig).not.toHaveBeenCalled();
    });

    it("still shows the song if the gig cannot be loaded", async () => {
      mocked.getGig.mockRejectedValue(new ApiError(404, "Gig not found"));
      renderPage("/songs/s1?gig=g1");
      expect(await screen.findByText("[Intro]")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Next song/ })).not.toBeInTheDocument();
    });
  });

  it("shows no setlist note outside a gig", async () => {
    renderPage("/songs/s1");
    await screen.findByText("[Intro]");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("makes the chord sheet bigger and smaller", async () => {
    localStorage.clear();
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Bigger text" }));
    expect(screen.getByTestId("sheet")).toHaveStyle({ fontSize: "17px" });
    fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    expect(screen.getByTestId("sheet")).toHaveStyle({ fontSize: "13px" });
    expect(screen.getByRole("button", { name: "Smaller text" })).toBeDisabled();
    localStorage.clear();
  });

  it("keeps the screen on while the song is open, without autoscroll", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    try {
      const { unmount } = renderPage();
      await screen.findByText("[Intro]");
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("screen");
      unmount();
      expect(release).toHaveBeenCalled();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).wakeLock;
    }
  });

  it("shows an error when the song cannot be loaded", async () => {
    mocked.getSong.mockRejectedValue(new ApiError(404, "Song not found"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Song not found");
  });
});

describe("SongPage original songs", () => {
  const track = { id: "t1", title: "Test Song", size: 3, parts: 1, uploadedParts: 1, songId: "s1", createdAt: "x" };
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows a player for an original song", async () => {
    mocked.getSong.mockResolvedValue({ ...song, trackId: "t1" });
    mocked.getTrack.mockResolvedValue(track);
    mocked.getTrackPart.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Play" }));
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    expect(mocked.getTrack).toHaveBeenCalledWith("t1");
    expect(mocked.getTrackPart).toHaveBeenCalledWith("t1", 0);
  });

  it("has no player for a regular song", async () => {
    renderPage();
    await screen.findByText("Test Song");
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
  });

  it("keeps the chord sheet when the recording can't load", async () => {
    mocked.getSong.mockResolvedValue({ ...song, trackId: "t1" });
    mocked.getTrack.mockRejectedValue(new Error("offline"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByText("Test Song")).toBeInTheDocument();
    expect(screen.getByText("la la")).toBeInTheDocument();
  });

  it("hints how to add lyrics when the sheet is empty", async () => {
    mocked.getSong.mockResolvedValue({ ...song, artist: "", content: "" });
    renderPage();
    expect(await screen.findByText("No lyrics or chords yet — tap Edit to add them.")).toBeInTheDocument();
    expect(screen.queryByText("by")).not.toBeInTheDocument();
  });
});

describe("SongPage lyrics mode", () => {
  const sheetText = () =>
    Array.from(document.querySelectorAll("[data-testid=sheet] .sheet-line")).map((l) => l.textContent);

  it("hides the chords and closes the gaps they leave, keeping section labels", async () => {
    mocked.getSong.mockResolvedValue({
      ...song,
      content: "[Verse 1]\n[ch]G[/ch]   [ch]C[/ch]\nla la\n[ch]D[/ch]\nlo lo\n\n[Instrumental]\n[ch]G[/ch] [ch]C[/ch]",
    });
    renderPage();
    await screen.findByText("[Verse 1]");
    fireEvent.click(screen.getByRole("button", { name: "Chords: on" }));
    expect(document.querySelectorAll(".chord")).toHaveLength(0);
    expect(sheetText()).toEqual(["[Verse 1]", "la la", "lo lo", "", "[Instrumental]"]);
    expect(screen.getByRole("button", { name: "Chords: off" })).toHaveAttribute("aria-pressed", "true");
  });

  it("brings the chords back in the current band key", async () => {
    mocked.updateSong.mockResolvedValue({ ...song, bandKey: "Bb" });
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Chords: on" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Chords: off" }));
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent)).toEqual(["Bb", "Eb"]),
    );
  });

  it("remembers the choice on this device for every song", async () => {
    const first = renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Chords: on" }));
    first.unmount();
    clearSongCache();
    mocked.getSong.mockResolvedValue({ ...song, id: "s2" });
    renderPage("/songs/s2");
    expect(await screen.findByRole("button", { name: "Chords: off" })).toBeInTheDocument();
    expect(document.querySelectorAll(".chord")).toHaveLength(0);
  });

  it("still shows the empty-song hint with chords off", async () => {
    localStorage.setItem("stereo-set:show-chords", "off");
    mocked.getSong.mockResolvedValue({ ...song, content: "" });
    renderPage();
    expect(await screen.findByText("No lyrics or chords yet — tap Edit to add them.")).toBeInTheDocument();
  });
});

describe("SongPage print lyrics", () => {
  const printed = () => document.querySelector(".print-lyrics");

  it("asks which version, then prints that one song in the band key", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage();
    await screen.findByText("[Intro]");
    expect(printed()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print lyrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Lyrics + chords" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const block = printed()!;
    expect(block.querySelector(".print-song-title")).toHaveTextContent("Test Song");
    expect(block.querySelector(".print-song-meta")).toHaveTextContent("The Band · Key: A");
    expect(Array.from(block.querySelectorAll(".chord")).map((c) => c.textContent)).toEqual(["A", "D"]);
    // The choice closes once printing started.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Lyrics only" })).not.toBeInTheDocument());
    print.mockRestore();
  });

  it("prints lyrics only without chords", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Print lyrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Lyrics only" }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printed()!.querySelectorAll(".chord")).toHaveLength(0);
    expect(printed()).toHaveTextContent("[Intro]");
    expect(printed()).toHaveTextContent("la la");
    print.mockRestore();
  });

  it("removes the print block once printing is done", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Print lyrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Lyrics only" }));
    await waitFor(() => expect(printed()).not.toBeNull());
    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(printed()).toBeNull());
    print.mockRestore();
  });

  it("prints the title and a no-lyrics note for an empty song", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    mocked.getSong.mockResolvedValue({ ...song, content: "" });
    renderPage();
    await screen.findByText("Test Song");
    fireEvent.click(screen.getByRole("button", { name: "Print lyrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Lyrics + chords" }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printed()).toHaveTextContent("No lyrics yet");
    print.mockRestore();
  });
});
