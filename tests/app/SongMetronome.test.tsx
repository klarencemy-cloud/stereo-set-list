import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getMetronome: vi.fn(), putMetronome: vi.fn(), getTime: vi.fn(), updateSong: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import SongMetronome, { NUDGE_KEY } from "../../src/app/components/SongMetronome";
import { METRONOME_KEY } from "../../src/app/components/Metronome";
import type { MetroSession } from "../../src/shared/metronome";
import type { Song } from "../../src/shared/types";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const song: Song = {
  id: "s1", title: "Song", artist: "Band", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, content: "",
  bpm: 96, beatsPerBar: 3, updatedAt: "x",
};

const running = (over: Partial<MetroSession> = {}): MetroSession => ({
  bpm: 120, beatsPerBar: 4, startAt: 10_000, running: true, updatedAt: "2026-11-15T10:00:00.000Z", ...over,
});

/** A looped bar the fake context was asked to play. */
interface FakeLoop {
  loop: boolean;
  loopEnd: number;
  when?: number;
  offset?: number;
  stoppedAt?: number;
}

/** A stand-in AudioContext that records the clicks and looped bars booked. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  started: number[] = [];
  loops: FakeLoop[] = [];
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const node: FakeLoop & Record<string, unknown> = {
      loop: false,
      loopEnd: 0,
      connect: (n: unknown) => n,
      start: (when: number, offset: number) => {
        node.when = when;
        node.offset = offset;
        this.loops.push(node);
      },
      stop: (at: number) => {
        node.stoppedAt = at;
      },
    };
    return node;
  }
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createOscillator() {
    return { frequency: { value: 0 }, connect: (n: unknown) => n, start: (t: number) => this.started.push(t), stop: () => {} };
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n, disconnect: () => {} };
  }
}

let perf = 0;
const onSongChange = vi.fn();

function renderPanel(s: Song = song) {
  return render(<SongMetronome song={s} onSongChange={onSongChange} />);
}

beforeEach(() => {
  localStorage.clear();
  Object.values(mocked).forEach((f) => f.mockReset());
  onSongChange.mockReset();
  FakeAudioContext.instances = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  perf = 0;
  vi.spyOn(performance, "now").mockImplementation(() => perf);
  mocked.getMetronome.mockResolvedValue(null);
  // The server's clock is 5 s ahead of performance.now(), and answers instantly.
  mocked.getTime.mockImplementation(async () => ({ now: perf + 5000 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SongMetronome, nothing running", () => {
  it("starts from the song's tempo and starts it for everyone", async () => {
    mocked.putMetronome.mockResolvedValue(running({ bpm: 96, beatsPerBar: 3 }));
    renderPanel();
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(mocked.getMetronome).toHaveBeenCalledWith("s1");
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("96");
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
    expect(mocked.putMetronome).toHaveBeenCalledWith("s1", { bpm: 97, beatsPerBar: 3, running: true });
    // The one who starts it is joined straight away.
    await screen.findByRole("button", { name: "Stop for everyone" });
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  it("uses this phone's last tempo when the song has none", async () => {
    localStorage.setItem(METRONOME_KEY, JSON.stringify({ bpm: 88, beatsPerBar: 5 }));
    renderPanel({ ...song, bpm: null, beatsPerBar: null });
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("88");
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    // Nobody has played it: the starting value is not offered as the song's tempo.
    expect(screen.queryByRole("button", { name: "Save as song tempo" })).toBeNull();
  });

  it("treats a song copy with the tempo fields missing as no tempo", async () => {
    const { bpm: _b, beatsPerBar: _p, ...old } = song;
    localStorage.setItem(METRONOME_KEY, JSON.stringify({ bpm: 88, beatsPerBar: 4 }));
    renderPanel(old as Song);
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("88");
  });
});

describe("SongMetronome, a session is running", () => {
  it("offers to join, and syncs the clock on Join", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    expect(await screen.findByText("Playing at 120 BPM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(/Synced ±\d+ ms/)).toBeInTheDocument();
    expect(mocked.getTime.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("Leave stops this phone only", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(mocked.putMetronome).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("Stop for everyone stops the session", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    mocked.putMetronome.mockResolvedValue(running({ running: false }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop for everyone" }));
    expect(mocked.putMetronome).toHaveBeenCalledWith("s1", { running: false });
    expect(await screen.findByRole("button", { name: "Start for everyone" })).toBeInTheDocument();
  });

  it("sends a tempo change from a joined phone", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    mocked.putMetronome.mockResolvedValue(running({ beatsPerBar: 6, startAt: 12_000 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Leave" });
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(mocked.putMetronome).toHaveBeenCalledWith("s1", { beatsPerBar: 6 });
    // Everyone (this phone too) shows the server's answer.
    await waitFor(() => expect(document.querySelectorAll(".metro-dot")).toHaveLength(6));
  });

  describe("playing", () => {
    let ctx: FakeAudioContext;
    /** Moves performance.now() and the audio clock together (audio 0 s = perf 4000 ms) and lets timers run. */
    const moveTo = async (ms: number, audioAheadS = 0) => {
      perf = ms;
      ctx.currentTime = (ms - 4000) / 1000 + audioAheadS;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });
    };
    const playing = () => ctx.loops.filter((l) => l.stoppedAt === undefined);
    /** How far (in bars) an audio time is from the nearest bar line of a 2 s grid through `line`. */
    const offBar = (t: number, line: number) => {
      const x = (t - line) / 2;
      return Math.abs(x - Math.round(x));
    };
    const round = (l: FakeLoop) => ({ when: +l.when!.toFixed(3), offset: +l.offset!.toFixed(3), loopEnd: l.loopEnd });

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
      localStorage.setItem(NUDGE_KEY, "100");
      perf = 4000; // server time 9000; beat 0 is at 10 000, bars of 2000 ms
      mocked.getMetronome.mockResolvedValue(running());
      renderPanel();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole("button", { name: "Join" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      ctx = FakeAudioContext.instances[0];
    });

    it("plays the shared grid as one looped bar, lined up with this phone's nudge", async () => {
      await moveTo(4010);
      // Beat 0 (server 10 000) is local 5000, played 100 ms early: local 4900 = audio 0.9 s. One bar = 2 s.
      expect(ctx.loops.map(round)).toEqual([{ when: 0.9, offset: 0, loopEnd: 2 }]);
      expect(ctx.loops[0].loop).toBe(true);
      // Later ticks and polls of the same session leave it alone.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      await moveTo(6000);
      await moveTo(9000);
      expect(ctx.loops).toHaveLength(1);
      expect(playing()).toHaveLength(1);
    });

    it("keeps playing while the screen is off: the audio engine loops the bar without any timers", async () => {
      await moveTo(4010);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      for (const ms of [5400, 7920, 12_430, 15_900]) await moveTo(ms);
      expect(playing().map(round)).toEqual([{ when: 0.9, offset: 0, loopEnd: 2 }]);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await moveTo(20_000);
      expect(ctx.loops).toHaveLength(1);
      expect(ctx.resume).toHaveBeenCalled();
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    });

    it("joins part-way through a bar that is already playing", async () => {
      await moveTo(4010);
      // A session that started long ago (server 1000): its bar lines are at audio -8.1 + 2k.
      mocked.getMetronome.mockResolvedValue(running({ startAt: 1000, updatedAt: "2026-11-15T10:00:07.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      const fresh = ctx.loops[ctx.loops.length - 1];
      expect(fresh.when!).toBeLessThan(0.2); // straight away, not at the next bar
      expect(fresh.offset!).toBeGreaterThan(0);
      expect(offBar(fresh.when! - fresh.offset!, -8.1)).toBeLessThan(1e-6);
    });

    it("switches to a new tempo exactly on the server's bar line", async () => {
      await moveTo(4010);
      mocked.getMetronome.mockResolvedValue(running({ bpm: 60, startAt: 12_000, updatedAt: "2026-11-15T10:00:05.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      await moveTo(5700);
      // New bar (4 beats at 60 = 4 s) from server 12 000 = audio 2.9; the old loop stops right there.
      expect(ctx.loops.map(round)).toEqual([
        { when: 0.9, offset: 0, loopEnd: 2 },
        { when: 2.9, offset: 0, loopEnd: 4 },
      ]);
      expect(ctx.loops[0].stoppedAt).toBeCloseTo(2.9);
      expect(ctx.loops[1].stoppedAt).toBeUndefined();
    });

    it("pulls a loop that drifted back onto the grid at the next bar line", async () => {
      await moveTo(4010);
      // The audio clock runs 30 ms ahead of where it was: the loop now sounds 30 ms early.
      await moveTo(6000, 0.03);
      expect(ctx.loops).toHaveLength(2);
      const [old, fresh] = ctx.loops;
      expect(fresh.offset).toBe(0);
      expect(old.stoppedAt).toBeCloseTo(fresh.when!);
      // The new loop's bar lines are back on the grid (bar line at audio 0.9 + 2k, plus the 30 ms).
      expect(offBar(fresh.when!, 0.93)).toBeLessThan(1e-6);
    });

    it("stops the loop when someone stops it for everyone", async () => {
      await moveTo(4010);
      mocked.getMetronome.mockResolvedValue(running({ running: false, updatedAt: "2026-11-15T10:00:09.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(playing()).toHaveLength(0);
    });
  });

  it("offers to save the session's tempo to the song", async () => {
    mocked.getMetronome.mockResolvedValue(running({ bpm: 100, beatsPerBar: 3 }));
    mocked.updateSong.mockResolvedValue({ ...song, bpm: 100, updatedAt: "y" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Save as song tempo" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bpm: 100, beatsPerBar: 3 }, "x");
    await waitFor(() => expect(onSongChange).toHaveBeenCalledWith({ ...song, bpm: 100, updatedAt: "y" }));
  });

  it("hides Save as song tempo when the song already has that tempo", async () => {
    mocked.getMetronome.mockResolvedValue(running({ bpm: 96, beatsPerBar: 3 }));
    renderPanel();
    await screen.findByText("Playing at 96 BPM");
    expect(screen.queryByRole("button", { name: "Save as song tempo" })).toBeNull();
  });

  it("shows a conflict when someone changed the song first", async () => {
    mocked.getMetronome.mockResolvedValue(running({ bpm: 100, beatsPerBar: 3 }));
    const current = { ...song, title: "Renamed", updatedAt: "z" };
    mocked.updateSong.mockRejectedValue(new ApiError(409, "Someone else changed this song.", current));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Save as song tempo" }));
    expect(await screen.findByText(/Someone else changed this song/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onSongChange).toHaveBeenCalledWith(current);
  });
});

describe("SongMetronome after a stop", () => {
  it("keeps the tempo it was playing at, so a restart and a save use what is on screen", async () => {
    mocked.getMetronome.mockResolvedValue(running({ bpm: 123 }));
    mocked.putMetronome.mockResolvedValue(running({ bpm: 123, running: false }));
    mocked.updateSong.mockResolvedValue({ ...song, bpm: 123, beatsPerBar: 4, updatedAt: "y" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Stop for everyone" }));
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("123");
    fireEvent.click(screen.getByRole("button", { name: "Save as song tempo" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bpm: 123, beatsPerBar: 4 }, "x");
  });

  it("saves the tempo on screen, not an older stopped session's", async () => {
    mocked.getMetronome.mockResolvedValue(running({ bpm: 140, running: false }));
    mocked.updateSong.mockResolvedValue({ ...song, bpm: 97, updatedAt: "y" });
    renderPanel();
    await screen.findByRole("button", { name: "Start for everyone" });
    // The song's own tempo is on screen: nothing to save.
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("96");
    expect(screen.queryByRole("button", { name: "Save as song tempo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as song tempo" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bpm: 97, beatsPerBar: 3 }, "x");
  });
});

describe("SongMetronome fallback", () => {
  it("plays on this phone only when the server can't be reached", async () => {
    mocked.getMetronome.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderPanel();
    expect(await screen.findByText("Can't sync: playing on this phone only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start on this phone" }));
    expect(FakeAudioContext.instances[0].loops.length).toBe(1);
    expect(mocked.putMetronome).not.toHaveBeenCalled();
  });

  it("plays on this phone only when the clock can't be synced", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    mocked.getTime.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    expect(await screen.findByText("Can't sync: playing on this phone only")).toBeInTheDocument();
  });
});

describe("Calibrate this phone", () => {
  it("saves the nudge on this phone", async () => {
    const { unmount } = renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    fireEvent.change(screen.getByRole("slider", { name: "Nudge" }), { target: { value: "140" } });
    expect(localStorage.getItem(NUDGE_KEY)).toBe("140");
    expect(screen.getByText("+140 ms (plays earlier)")).toBeInTheDocument();
    unmount();
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    expect(screen.getByRole("slider", { name: "Nudge" })).toHaveValue("140");
  });

  it("measures the nudge from a tap-along", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    fireEvent.click(screen.getByRole("button", { name: "Tap along" }));
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.started).toHaveLength(12);
    // Tap every click 140 ms late (the audio clock and performance.now() both start at 0 here).
    for (const t of ctx.started) {
      perf = t * 1000 + 140;
      fireEvent.pointerDown(screen.getByRole("button", { name: "Tap" }));
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText("Measured +140 ms, saved")).toBeInTheDocument();
    expect(localStorage.getItem(NUDGE_KEY)).toBe("140");
  });

  it("says so when the taps are too few to measure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    fireEvent.click(screen.getByRole("button", { name: "Tap along" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Tap" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText("Couldn't measure, try again")).toBeInTheDocument();
    expect(localStorage.getItem(NUDGE_KEY)).toBeNull();
  });
});

describe("session checks", () => {
  const calls = () => mocked.getMetronome.mock.calls.length;
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  });
  afterEach(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });

  it("checks every 10 s while the panel is open but this phone isn't joined", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    await advance(0);
    expect(calls()).toBe(1); // on open
    await advance(9_000);
    expect(calls()).toBe(1); // not every 1.5 s any more
    await advance(1_000);
    expect(calls()).toBe(2);
  });

  it("checks at once on Join, then every 1.5 s", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    expect(calls()).toBe(2);
    await advance(1_500);
    expect(calls()).toBe(3);
  });

  it("joined with the session stopped still checks every 1.5 s", async () => {
    // Start for everyone joins this phone; the server answers with a session that someone then stops.
    mocked.putMetronome.mockResolvedValue(running());
    mocked.getMetronome.mockResolvedValue(null);
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
    await advance(0);
    mocked.getMetronome.mockResolvedValue(running({ running: false, updatedAt: "2026-11-15T10:00:09.000Z" }));
    const before = calls();
    await advance(3_000);
    expect(calls() - before).toBe(2);
  });

  it("makes no checks while the screen is off, and one as soon as it is back", async () => {
    renderPanel();
    await advance(0);
    setHidden(true);
    const before = calls();
    await advance(60_000);
    expect(calls()).toBe(before);
    setHidden(false);
    await advance(0);
    expect(calls()).toBe(before + 1);
  });

  it("toggling visibility doesn't start a second chain", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    setHidden(true);
    setHidden(false);
    setHidden(true);
    setHidden(false);
    await advance(0);
    const before = calls();
    await advance(3_000);
    expect(calls() - before).toBe(2); // still one check per 1.5 s
  });

  it("a failed check while joined keeps checking every 1.5 s", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    mocked.getMetronome.mockRejectedValue(new ApiError(0, "offline"));
    const before = calls();
    await advance(3_000);
    expect(calls() - before).toBe(2);
  });

  it("a slow answer doesn't stretch the 1.5 s between checks while joined", async () => {
    mocked.getMetronome.mockResolvedValue(running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    // Every answer now takes 600 ms, as on a slow connection.
    mocked.getMetronome.mockImplementation(() => new Promise((r) => setTimeout(() => r(running()), 600)));
    const before = calls();
    await advance(6_000);
    expect(calls() - before).toBe(4); // one every 1.5 s, not every 2.1 s
  });

  it("no checks after the panel closes", async () => {
    const { unmount } = renderPanel();
    await advance(0);
    unmount();
    const before = calls();
    await advance(30_000);
    expect(calls()).toBe(before);
  });
});
