// @vitest-environment jsdom
// E. Navigation and UX (H13, H15), plus H6 (a hidden phone) as far as code can show it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      updateSong: vi.fn(), getSong: vi.fn(), getGig: vi.fn(), getTrack: vi.fn(), getTrackPart: vi.fn(), listSongs: vi.fn(),
    },
  };
});

import SongPage from "../../src/app/pages/SongPage";
import SongMetronome from "../../src/app/components/SongMetronome";
import { clearSongCache } from "../../src/app/songCache";
import type { Song } from "../../src/shared/types";
import { advance, dropWakeLock, FakeAudioContext, setHidden, setupWorld, soundingAt, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
let songB: Song;
let nav: (path: string) => void;

function Nav() {
  nav = useNavigate();
  return null;
}

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/songs/${id}`]}>
      <Nav />
      <Routes>
        <Route path="/songs/:id" element={<SongPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pill = () => screen.getByRole("button", { name: /^Metronome/ });
const liveDot = () => pill().querySelector(".live-dot") !== null;

beforeEach(async () => {
  w = await setupWorld();
  clearSongCache();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
  songB = await w.repo.createSong({
    title: "Next", artist: "Band", sourceUrl: null, originalKey: "D", bandKey: "D", capo: 0, content: "", bpm: 140, beatsPerBar: 4,
  });
});
afterEach(teardownWorld);

describe("H13: swiping to the next song with the metronome open", () => {
  it("refuted: the panel closes, this phone stops and leaves, and the next song's panel starts fresh", async () => {
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    renderPage(w.song.id);
    await advance(200, 10);
    fireEvent.click(pill());
    await advance(100, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(3000, 10);
    const ctx = FakeAudioContext.instances[0];
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);

    act(() => nav(`/songs/${songB.id}`)); // what a swipe does
    await advance(200, 10);
    expect(screen.queryByRole("region", { name: "Metronome" })).toBeNull();
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(0);
    expect(ctx.close).toHaveBeenCalled();
    const calls = world.sent.getMetronome;
    await advance(5000, 50);
    expect(world.sent.getMetronome).toBe(calls); // no checks for the old song keep running

    fireEvent.click(pill());
    await advance(100, 10);
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("140"); // song B's tempo, not A's 120
    expect(screen.getByRole("button", { name: "Start for everyone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull(); // not still joined
  });

  it("regression: a SongMetronome re-rendered with another song starts fresh with that song's tempo", async () => {
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    const r = render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(200, 10);
    expect(screen.getByText("Playing at 120 BPM")).toBeInTheDocument();
    r.rerender(<SongMetronome song={songB} onSongChange={() => {}} />);
    await advance(200, 10);
    expect(screen.queryByText("Playing at 120 BPM")).toBeNull();
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("140"); // song B's tempo, not song A's 96
  });
});

describe("H15: the pill's live dot", () => {
  it.fails("BUG H15: no live dot 30 s after a bandmate starts it, while the panel is closed", async () => {
    renderPage(w.song.id);
    await advance(500, 10);
    expect(liveDot()).toBe(false);
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    await advance(30_000, 100);
    expect(liveDot()).toBe(true);
  });

  it.fails("BUG H15: the live dot stays lit 30 s after someone stops it", async () => {
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    renderPage(w.song.id);
    await advance(500, 10);
    expect(liveDot()).toBe(true);
    await w.other({ running: false });
    await advance(30_000, 100);
    expect(liveDot()).toBe(false);
  });
});

describe("the screen keep-on on a song page", () => {
  it("is asked for again, silently, when the phone drops it while the page is visible", async () => {
    renderPage(w.song.id);
    await advance(500, 10);
    expect(world.wakeLock.held).toBe(1);
    const page = document.body.innerHTML;
    dropWakeLock();
    await advance(100, 10);
    expect(world.wakeLock.requests).toBe(2);
    expect(world.wakeLock.held).toBe(1);
    expect(document.body.innerHTML).toBe(page);
  });

  it("shows nothing when the phone refuses it again, and doesn't keep asking", async () => {
    renderPage(w.song.id);
    await advance(500, 10);
    const page = document.body.innerHTML;
    world.wakeLock.refuse = true;
    dropWakeLock();
    await advance(5000, 50);
    expect(world.wakeLock.requests).toBe(2);
    expect(world.wakeLock.held).toBe(0);
    expect(document.body.innerHTML).toBe(page);
  });
});

describe("H6: a joined phone with its screen off", () => {
  it("by design: it keeps playing the old grid after Stop for everyone, and stops at once when it is visible again", async () => {
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(3000, 10);
    const ctx = FakeAudioContext.instances[0];
    setHidden(true);
    await advance(2000, 10); // a check already in flight when the screen went off still lands
    const sentBefore = world.sent.getMetronome;
    await w.other({ running: false });
    await advance(20_000, 100);
    expect(world.sent.getMetronome).toBe(sentBefore); // no checks while hidden
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1); // still clicking, nobody can stop it remotely
    setHidden(false);
    await advance(100, 10);
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(0);
  });
});
