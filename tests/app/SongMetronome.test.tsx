import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getMetronome: vi.fn(), putMetronome: vi.fn(), getTime: vi.fn(), updateSong: vi.fn() } };
});

vi.mock("../../src/app/metronome/listen", () => ({ listen: vi.fn(() => new Promise(() => {})) }));

import { api, ApiError } from "../../src/app/api";
import SongMetronome, { NUDGE_KEY, ROUNDTRIP_KEY } from "../../src/app/components/SongMetronome";
import { DEVICE_KEY } from "../../src/app/device";
import { listen } from "../../src/app/metronome/listen";
import { METRONOME_KEY } from "../../src/app/components/Metronome";
import type { MetroSession } from "../../src/shared/metronome";
import type { Song } from "../../src/shared/types";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const listenMock = listen as unknown as ReturnType<typeof vi.fn>;

/** A recording of `seconds` from audio time `startS`, with a metronome click (as renderBar makes) at each time. */
function recording(sampleRate: number, startS: number, seconds: number, clickTimes: number[]) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const len = Math.round(0.05 * sampleRate);
  for (const t of clickTimes) {
    const at = Math.round((t - startS) * sampleRate);
    for (let j = 0; j < len && at + j < samples.length; j++) {
      if (at + j < 0) continue;
      const u = j / sampleRate;
      samples[at + j] += 0.6 * Math.exp((-Math.log(1000) / 0.05) * u) * Math.sin(2 * Math.PI * 1000 * u);
    }
  }
  return { samples, startS };
}

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
  state = "running";
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
/** How far the server's clock is ahead of performance.now() (ms). */
let serverAhead = 5000;
const onSongChange = vi.fn();

/** Answers a metronome call with `session` and the server's time when it answers (instantly). */
const serve = (fn: ReturnType<typeof vi.fn>, session: MetroSession | null) =>
  fn.mockImplementation(async () => ({ session, now: perf + serverAhead }));

/** Answers a PUT with `session`, and from then on every GET too, as the server stores it. */
const store = (session: MetroSession) =>
  mocked.putMetronome.mockImplementation(async () => {
    serve(mocked.getMetronome, session);
    return { session, now: perf + serverAhead };
  });

function renderPanel(s: Song = song) {
  return render(<SongMetronome song={s} onSongChange={onSongChange} />);
}

beforeEach(() => {
  localStorage.clear();
  Object.values(mocked).forEach((f) => f.mockReset());
  listenMock.mockReset();
  listenMock.mockImplementation(() => new Promise(() => {}));
  onSongChange.mockReset();
  FakeAudioContext.instances = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  perf = 0;
  serverAhead = 5000;
  vi.spyOn(performance, "now").mockImplementation(() => perf);
  serve(mocked.getMetronome, null);
  // The server's clock is 5 s ahead of performance.now(), and answers instantly.
  mocked.getTime.mockImplementation(async () => ({ now: perf + serverAhead }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SongMetronome, nothing running", () => {
  it("starts from the song's tempo and starts it for everyone", async () => {
    serve(mocked.putMetronome, running({ bpm: 96, beatsPerBar: 3 }));
    renderPanel();
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(mocked.getMetronome).toHaveBeenCalledWith("s1", false); // not joined: doesn't mark it seen
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("96");
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
    // ...as its leader: this phone's own id, made once and kept.
    const me = localStorage.getItem(DEVICE_KEY);
    expect(me).toBeTruthy();
    // ...only if nobody has started it meanwhile.
    expect(mocked.putMetronome).toHaveBeenCalledWith("s1", { bpm: 97, beatsPerBar: 3, running: true, leader: me, onlyIfStopped: true });
    // The one who starts it is joined straight away.
    await screen.findByRole("button", { name: "Stop for everyone" });
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  it("a start that finds it already playing shows 'Already playing at N BPM', and Join plays theirs", async () => {
    // This panel still shows stopped, but a bandmate started it at 120/4 meanwhile: the server leaves theirs alone.
    const theirs = running({ leader: "drummer" });
    mocked.putMetronome.mockImplementation(async () => ({ session: theirs, now: perf + serverAhead, applied: false }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Start for everyone" }));
    expect(await screen.findByText("Already playing at 120 BPM")).toBeInTheDocument();
    // Not joined: no Leave, no loop booked, no error.
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(FakeAudioContext.instances[0].loops).toEqual([]);
    serve(mocked.getMetronome, theirs);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(await screen.findByText(/Synced ±\d+ ms/)).toBeInTheDocument();
    expect(screen.queryByText("Already playing at 120 BPM")).toBeNull();
    expect(mocked.putMetronome).toHaveBeenCalledTimes(1); // Join changes nothing for everyone
    await waitFor(() => expect(FakeAudioContext.instances[0].loops.length).toBeGreaterThan(0));
  });

  it("after 'Already playing', a Leave shows plain 'Playing at N BPM' again", async () => {
    const theirs = running({ leader: "drummer" });
    mocked.putMetronome.mockImplementation(async () => ({ session: theirs, now: perf + serverAhead, applied: false }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Start for everyone" }));
    await screen.findByText("Already playing at 120 BPM");
    serve(mocked.getMetronome, theirs);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Playing at 120 BPM")).toBeInTheDocument();
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
    serve(mocked.getMetronome, running());
    renderPanel();
    expect(await screen.findByText("Playing at 120 BPM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(/Synced ±\d+ ms/)).toBeInTheDocument();
    expect(mocked.getTime.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("Leave stops this phone only", async () => {
    serve(mocked.getMetronome, running());
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(mocked.putMetronome).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("Stop for everyone stops the session", async () => {
    serve(mocked.getMetronome, running());
    store(running({ running: false, updatedAt: "2026-11-15T10:00:01.000Z" }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop for everyone" }));
    expect(mocked.putMetronome).toHaveBeenCalledWith("s1", { running: false });
    expect(await screen.findByRole("button", { name: "Start for everyone" })).toBeInTheDocument();
  });

  it("sends a tempo change from a joined phone", async () => {
    serve(mocked.getMetronome, running());
    store(running({ beatsPerBar: 6, startAt: 12_000, updatedAt: "2026-11-15T10:00:01.000Z" }));
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
      serve(mocked.getMetronome, running());
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
        await vi.advanceTimersByTimeAsync(2100);
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
      serve(mocked.getMetronome, running({ startAt: 1000, updatedAt: "2026-11-15T10:00:07.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      const fresh = ctx.loops[ctx.loops.length - 1];
      expect(fresh.when!).toBeLessThan(0.2); // straight away, not at the next bar
      expect(fresh.offset!).toBeGreaterThan(0);
      expect(offBar(fresh.when! - fresh.offset!, -8.1)).toBeLessThan(1e-6);
    });

    it("switches to a new tempo exactly on the server's bar line", async () => {
      await moveTo(4010);
      serve(mocked.getMetronome, running({ bpm: 60, startAt: 12_000, updatedAt: "2026-11-15T10:00:05.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
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
      // The audio clock runs 30 ms ahead of where it was: the loop now sounds 30 ms early. One tick of it isn't
      // enough (that could be jitter); it is moved once the error has lasted a few ticks.
      await moveTo(6000, 0.03);
      expect(ctx.loops).toHaveLength(1);
      for (let ms = 6030; ms <= 6300; ms += 30) await moveTo(ms, 0.03);
      expect(ctx.loops).toHaveLength(2);
      const [old, fresh] = ctx.loops;
      expect(fresh.offset).toBe(0);
      // The old loop runs 30 ms early: it stops at its own bar line, before that line's click (H9).
      expect(old.stoppedAt).toBeCloseTo(fresh.when! - 0.03);
      // The new loop's bar lines are back on the grid (bar line at audio 0.9 + 2k, plus the 30 ms).
      expect(offBar(fresh.when!, 0.93)).toBeLessThan(1e-6);
    });

    it("stops the loop when someone stops it for everyone", async () => {
      await moveTo(4010);
      serve(mocked.getMetronome, running({ running: false, updatedAt: "2026-11-15T10:00:09.000Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(playing()).toHaveLength(0);
    });
  });

  it("offers to save the session's tempo to the song", async () => {
    serve(mocked.getMetronome, running({ bpm: 100, beatsPerBar: 3 }));
    mocked.updateSong.mockResolvedValue({ ...song, bpm: 100, updatedAt: "y" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Save as song tempo" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bpm: 100, beatsPerBar: 3 }, "x");
    await waitFor(() => expect(onSongChange).toHaveBeenCalledWith({ ...song, bpm: 100, updatedAt: "y" }));
  });

  it("hides Save as song tempo when the song already has that tempo", async () => {
    serve(mocked.getMetronome, running({ bpm: 96, beatsPerBar: 3 }));
    renderPanel();
    await screen.findByText("Playing at 96 BPM");
    expect(screen.queryByRole("button", { name: "Save as song tempo" })).toBeNull();
  });

  it("shows a conflict when someone changed the song first", async () => {
    serve(mocked.getMetronome, running({ bpm: 100, beatsPerBar: 3 }));
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
    serve(mocked.getMetronome, running({ bpm: 123 }));
    store(running({ bpm: 123, running: false, updatedAt: "2026-11-15T10:00:01.000Z" }));
    mocked.updateSong.mockResolvedValue({ ...song, bpm: 123, beatsPerBar: 4, updatedAt: "y" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Stop for everyone" }));
    await screen.findByRole("button", { name: "Start for everyone" });
    expect(document.querySelector(".metro-bpm")).toHaveTextContent("123");
    fireEvent.click(screen.getByRole("button", { name: "Save as song tempo" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bpm: 123, beatsPerBar: 4 }, "x");
  });

  it("saves the tempo on screen, not an older stopped session's", async () => {
    serve(mocked.getMetronome, running({ bpm: 140, running: false }));
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
    // Answers that carry no server time (an older server), so only the time calls could sync the clock.
    mocked.getMetronome.mockImplementation(async () => ({ session: running() }));
    mocked.getTime.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderPanel();
    const join = await screen.findByRole("button", { name: "Join" });
    // The network goes after that first check, so no answer brings the server's time either.
    mocked.getMetronome.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    fireEvent.click(join);
    expect(await screen.findByText("Can't sync: playing on this phone only")).toBeInTheDocument();
  });
});

describe("matching the band by ear", () => {
  let ctx: FakeAudioContext;
  /** Moves performance.now() and the audio clock together (audio 0 s = perf 4000 ms) and lets timers run. */
  const moveTo = async (ms: number) => {
    perf = ms;
    ctx.currentTime = (ms - 4000) / 1000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
  };
  const flush = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const playing = () => ctx.loops.filter((l) => l.stoppedAt === undefined);
  /** A listen the test answers when it likes. */
  function deferListen() {
    const calls: { resolve: (r: unknown) => void; reject: (e: unknown) => void; seconds: number }[] = [];
    listenMock.mockImplementation(
      (_ctx: unknown, seconds: number) => new Promise((resolve, reject) => calls.push({ resolve, reject, seconds })),
    );
    return calls;
  }
  /**
   * What the mic hears when this phone, by the clock, would be `lateMs` behind the band: beat n is due at audio
   * 0.9 + 0.5n (server 10 000 + 500n, offset 5000, nudge 100, audio 0 = perf 4000), heard a round trip (50 ms) later.
   */
  const band = (lateMs: number, seconds = 4.9) =>
    recording(48000, 0, seconds, Array.from({ length: 9 }, (_, n) => 0.9 + 0.5 * n + 0.05 - lateMs / 1000));

  async function joinAs(session: MetroSession, measured = true) {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    localStorage.setItem(NUDGE_KEY, "100");
    if (measured) localStorage.setItem(ROUNDTRIP_KEY, "50");
    localStorage.setItem(DEVICE_KEY, "me");
    perf = 4000; // server time 9000; beat 0 is at 10 000, bars of 2000 ms
    serve(mocked.getMetronome, session);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await flush();
    ctx = FakeAudioContext.instances[0];
  }

  it("stays silent while listening, then plays with the heard shift applied", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0][0]).toBe(ctx);
    // Until beat 0 (0.9 s away), then 2 bars (4 s).
    expect(calls[0].seconds).toBeCloseTo(4.9, 6);
    await moveTo(4010);
    await moveTo(4500);
    expect(ctx.loops).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Listening to the band…");
    // The band is heard 20 ms before this phone's clock says: it plays 20 ms earlier than by the clock.
    calls[0].resolve(band(20));
    await moveTo(4510);
    expect(playing()).toHaveLength(1);
    expect(playing()[0].when!).toBeCloseTo(0.88, 3);
    expect(screen.getByRole("status")).toHaveTextContent("Matched to the band ±1 ms");
    expect(screen.queryByRole("button", { name: "Listen again" })).toBeNull();
  });

  it("the leader never listens: it is the reference", async () => {
    await joinAs(running({ leader: "me" }));
    await moveTo(4010);
    expect(listenMock).not.toHaveBeenCalled();
    expect(playing().map((l) => +l.when!.toFixed(3))).toEqual([0.9]);
    expect(screen.getByRole("status")).toHaveTextContent(/^Leading · synced ±\d+ ms$/);
  });

  it("plays by the clock alone when it can't hear the band, and Listen again goes silent and tries again", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    calls[0].reject(new DOMException("blocked", "NotAllowedError"));
    await moveTo(4010);
    expect(playing().map((l) => +l.when!.toFixed(3))).toEqual([0.9]);
    expect(screen.getByRole("status")).toHaveTextContent(/^Couldn't hear the band, synced by clock ±\d+ ms$/);
    fireEvent.click(screen.getByRole("button", { name: "Listen again" }));
    await moveTo(4100);
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(playing()).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Listening to the band…");
    calls[1].resolve(band(-15, calls[1].seconds));
    await moveTo(4200);
    expect(playing()[0].when!).toBeCloseTo(0.915, 3);
  });

  it("falls back to the clock when the beats heard are too few", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    calls[0].resolve(recording(48000, 0, 4.9, [1.0, 1.5]));
    await moveTo(4010);
    expect(playing().map((l) => +l.when!.toFixed(3))).toEqual([0.9]);
    expect(screen.getByRole("button", { name: "Listen again" })).toBeInTheDocument();
  });

  it("a tempo change keeps the match", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    calls[0].resolve(band(20));
    await moveTo(4010);
    serve(mocked.getMetronome, running({ leader: "them", bpm: 60, startAt: 12_000, updatedAt: "2026-11-15T10:00:05.000Z" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await moveTo(5700);
    expect(listenMock).toHaveBeenCalledTimes(1);
    // The new bar (server 12 000) is played 20 ms early too.
    expect(ctx.loops[ctx.loops.length - 1].when!).toBeCloseTo(2.88, 3);
  });

  it("a new leader clears the match and listens again", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    calls[0].resolve(band(20));
    await moveTo(4010);
    expect(playing()[0].when!).toBeCloseTo(0.88, 3);
    serve(mocked.getMetronome, running({ leader: "someone-else", updatedAt: "2026-11-15T10:00:05.000Z" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(playing()).toHaveLength(0);
    // Nothing heard this time: by the clock alone, with no trace of the old shift.
    calls[1].resolve(recording(48000, 0, 3, []));
    await moveTo(5700);
    expect(playing()).toHaveLength(1);
    const l = playing()[0];
    expect(((l.when! - l.offset! - 0.9) / 2) % 1).toBeCloseTo(0, 6);
  });

  it("a later sync round doesn't undo the match", async () => {
    const calls = deferListen();
    await joinAs(running({ leader: "them" }));
    calls[0].resolve(band(20));
    await moveTo(4010);
    await moveTo(6000); // the loop is playing, so it is checked for drift
    const booked = ctx.loops.length;
    const checks = mocked.getMetronome.mock.calls.length;
    // The clock estimate moves by 40 ms; once the first round has aged out, a clock-only phone would follow it.
    serverAhead = 5040;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 100);
    });
    await moveTo(6100);
    // The session checks brought the moved clock's samples, over more than ROUNDS_KEPT rounds.
    expect(mocked.getMetronome.mock.calls.length - checks).toBeGreaterThanOrEqual(80);
    expect(ctx.loops).toHaveLength(booked);
    expect(screen.getByRole("status")).toHaveTextContent("Matched to the band");
  });

  it("without a measured round trip it plays by the clock and points to Measure this phone", async () => {
    await joinAs(running({ leader: "them" }), false);
    await moveTo(4010);
    expect(listenMock).not.toHaveBeenCalled();
    expect(playing().map((l) => +l.when!.toFixed(3))).toEqual([0.9]);
    expect(screen.getByRole("status")).toHaveTextContent(/^Synced ±\d+ ms$/);
    expect(screen.getByText(/tap Measure this phone/)).toBeInTheDocument();
  });

  it("an old session with no leader plays by the clock without listening", async () => {
    await joinAs(running());
    await moveTo(4010);
    expect(listenMock).not.toHaveBeenCalled();
    expect(playing().map((l) => +l.when!.toFixed(3))).toEqual([0.9]);
    expect(screen.queryByText(/tap Measure this phone/)).toBeNull();
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

  it("measures this phone's round trip from clicks it plays and hears, and saves it", async () => {
    listenMock.mockImplementation(async (ctx: FakeAudioContext, seconds: number, opts: { onStart?: () => void }) => {
      opts.onStart?.();
      expect(ctx.started).toHaveLength(8);
      return recording(ctx.sampleRate, 0, seconds, ctx.started.map((t) => t + 0.142));
    });
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    expect(screen.getByText(/Not measured yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Measure this phone" }));
    expect(await screen.findByText("Measured 142 ms, saved")).toBeInTheDocument();
    expect(Number(localStorage.getItem(ROUNDTRIP_KEY))).toBeCloseTo(142, 0);
    expect(screen.getByText(/Measured: 142 ms/)).toBeInTheDocument();
  });

  it("saves nothing when no clicks are heard", async () => {
    listenMock.mockImplementation(async (_ctx: FakeAudioContext, seconds: number, opts: { onStart?: () => void }) => {
      opts.onStart?.();
      return recording(48000, 0, seconds, []);
    });
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    fireEvent.click(screen.getByRole("button", { name: "Measure this phone" }));
    expect(await screen.findByText(/Couldn't hear the clicks/)).toBeInTheDocument();
    expect(localStorage.getItem(ROUNDTRIP_KEY)).toBeNull();
  });

  it("says so when the mic is blocked, and saves nothing", async () => {
    listenMock.mockRejectedValue(new DOMException("no", "NotAllowedError"));
    renderPanel();
    fireEvent.click(screen.getByText("Calibrate this phone"));
    fireEvent.click(screen.getByRole("button", { name: "Measure this phone" }));
    expect(await screen.findByText(/Microphone access was blocked/)).toBeInTheDocument();
    expect(localStorage.getItem(ROUNDTRIP_KEY)).toBeNull();
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
    serve(mocked.getMetronome, running());
    renderPanel();
    await advance(0);
    expect(calls()).toBe(1); // on open
    await advance(9_000);
    expect(calls()).toBe(1); // not every 2 s any more
    await advance(1_000);
    expect(calls()).toBe(2);
  });

  it("checks at once on Join, then every 2 s", async () => {
    serve(mocked.getMetronome, running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    expect(calls()).toBe(2);
    await advance(1_900);
    expect(calls()).toBe(2); // not every 1.5 s any more
    await advance(100);
    expect(calls()).toBe(3);
  });

  it("joined with the session stopped still checks every 2 s", async () => {
    // Start for everyone joins this phone; the server answers with a session that someone then stops.
    serve(mocked.putMetronome, running());
    serve(mocked.getMetronome, null);
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
    await advance(0);
    serve(mocked.getMetronome, running({ running: false, updatedAt: "2026-11-15T10:00:09.000Z" }));
    const before = calls();
    await advance(4_000);
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
    serve(mocked.getMetronome, running());
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
    await advance(4_000);
    expect(calls() - before).toBe(2); // still one check per 2 s
  });

  it("a failed check while joined keeps checking every 2 s", async () => {
    serve(mocked.getMetronome, running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    mocked.getMetronome.mockRejectedValue(new ApiError(0, "offline"));
    const before = calls();
    await advance(4_000);
    expect(calls() - before).toBe(2);
  });

  it("a slow answer doesn't stretch the 2 s between checks while joined", async () => {
    serve(mocked.getMetronome, running());
    renderPanel();
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(0);
    // Every answer now takes 600 ms, as on a slow connection.
    mocked.getMetronome.mockImplementation(() => new Promise((r) => setTimeout(() => r({ session: running(), now: perf + serverAhead }), 600)));
    const before = calls();
    await advance(8_000);
    expect(calls() - before).toBe(4); // one every 2 s, not every 2.6 s
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
