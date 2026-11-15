import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The home page (Gigs) loads on "/": keep it waiting so the test needs no server.
vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listGigs: vi.fn(() => new Promise(() => {})) } };
});

import ToolsPage from "../../src/app/pages/ToolsPage";
import { AppRoutes } from "../../src/app/App";
import { analysisSize } from "../../src/app/tuner/pitch";

/** A stand-in AudioContext that records the clicks booked and lets tests move its clock. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  state = "running";
  started: number[] = [];
  /** Looped bars of clicks: when they start, how far into the bar, the bar length, and when they stop. */
  loops: { loop: boolean; loopEnd: number; when?: number; offset?: number; stoppedAt?: number }[] = [];
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const node = {
      loop: false,
      loopEnd: 0,
      when: undefined as number | undefined,
      offset: undefined as number | undefined,
      stoppedAt: undefined as number | undefined,
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
  /** What the fake microphone "hears". */
  input: Float32Array | null = null;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createOscillator() {
    return {
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start: (t: number) => this.started.push(t),
      stop: () => {},
    };
  }
  createGain() {
    const node = {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: (n: unknown) => n,
    };
    return node;
  }
  createAnalyser() {
    const ctx = this;
    return {
      fftSize: 2048,
      getFloatTimeDomainData(buf: Float32Array) {
        if (ctx.input) buf.set(ctx.input.subarray(0, buf.length));
        else buf.fill(0);
      },
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
}

function sine(freq: number, sr = 48000): Float32Array {
  const n = analysisSize(sr);
  return Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin((2 * Math.PI * freq * i) / sr));
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();

beforeEach(() => {
  localStorage.clear();
  FakeAudioContext.instances = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  track.stop.mockReset();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderTools() {
  return render(
    <MemoryRouter>
      <ToolsPage />
    </MemoryRouter>,
  );
}

describe("Tools in the main nav", () => {
  it("has a Tools link that opens the tools page", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Tools" }));
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  });
});

describe("Tuner", () => {
  const a4 = () => screen.getByRole("spinbutton", { name: "Reference pitch A4" }) as HTMLInputElement;
  const reset = () => screen.queryByRole("button", { name: "Reset to 440" });

  /** Starts the tuner and returns a function that plays a tone into the fake microphone. */
  async function startListening() {
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await act(async () => {});
    const ctx = FakeAudioContext.instances[0];
    return async (input: Float32Array, ms = 350) => {
      ctx.input = input;
      await listen(ms);
    };
  }

  /**
   * Lets the fake clock run for `ms`, one 50 ms microphone reading per act(). In a browser each reading is its own
   * task and renders on its own; one long act() would batch them all into one render, and the in-tune hold
   * (which counts readings over time) would only see the last.
   */
  async function listen(ms: number) {
    for (let t = 0; t < ms; t += 50) {
      await act(async () => {
        vi.advanceTimersByTime(Math.min(50, ms - t));
      });
    }
  }

  it("is chromatic: no instrument switch and no string list", () => {
    renderTools();
    expect(screen.queryByRole("button", { name: "Guitar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bass" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Strings" })).toBeNull();
    expect(screen.queryByText("Chromatic tuner. Uses the microphone.")).toBeNull();
  });

  const cents = () => document.querySelector(".tuner-cents")!;
  const needle = () => document.querySelector(".tuner-needle");
  const lit = () => Array.from(document.querySelectorAll(".tuner-dir .on")).map((el) => el.textContent);

  it("before Start, says what to do and shows no needle", () => {
    renderTools();
    expect(cents()).toHaveTextContent("Tap Start, then play a note");
    expect(needle()).toBeNull();
    expect(lit()).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows Listening while the microphone is on", async () => {
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await screen.findByRole("button", { name: "Stop tuner" });
    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    // Listening but nothing heard yet: a prompt, still no needle.
    expect(cents()).toHaveTextContent("Play a note");
    expect(needle()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop tuner" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(cents()).toHaveTextContent("Tap Start, then play a note");
  });

  it("says which way to turn, and lights that side of the meter", async () => {
    renderTools();
    const play = await startListening();
    await play(sine(110 * Math.pow(2, 20 / 1200))); // 20 cents sharp
    expect(cents()).toHaveTextContent("+20 cents · tune down");
    expect(cents().querySelector("strong")).toHaveTextContent("+20 cents");
    expect(needle()).not.toBeNull();
    expect(lit()).toEqual(["▶ ♯"]);

    await play(sine(110), 1700); // glides to 0, then holds it for a second: in tune, neither side lit
    expect(cents()).toHaveTextContent("In tune");
    expect(lit()).toEqual([]);
    expect(document.querySelector(".tuner.in-tune")).not.toBeNull();

    // Silence: once the tuner stops holding the last note (1 s), the needle goes away.
    for (let i = 0; i < 4; i++) await play(sine(0));
    expect(needle()).toBeNull();
    expect(cents()).toHaveTextContent("Play a note");
  });

  const fill = () => document.querySelector(".tuner-hold-fill") as HTMLElement;

  it("holds 0 for a second before saying In tune", async () => {
    renderTools();
    const play = await startListening();
    await play(sine(110), 350);
    expect(cents()).toHaveTextContent("0 cents · hold…");
    expect(cents()).not.toHaveTextContent("In tune");
    expect(parseFloat(fill().style.width)).toBeGreaterThan(0);
    await play(sine(110), 600); // 950 ms in: the hold started at the 3rd reading, so not yet
    expect(cents()).toHaveTextContent("hold…");
    expect(document.querySelector(".tuner.in-tune")).toBeNull();
    expect(parseFloat(fill().style.width)).toBeLessThan(100);
    await play(sine(110), 400);
    expect(cents()).toHaveTextContent("In tune");
    expect(document.querySelector(".tuner.in-tune")).not.toBeNull();
    expect(fill().style.width).toBe("100%");
  });

  it("never calls 4 cents sharp in tune", async () => {
    renderTools();
    const play = await startListening();
    for (let i = 0; i < 10; i++) {
      await play(sine(110 * Math.pow(2, 4 / 1200)), 300);
      expect(cents()).not.toHaveTextContent("In tune");
      expect(cents()).not.toHaveTextContent("hold");
    }
    expect(cents()).toHaveTextContent("+4 cents · tune down");
    expect(lit()).toEqual(["▶ ♯"]);
  });

  it("calls 2 cents sharp in tune once held, showing the real cents while holding", async () => {
    renderTools();
    const play = await startListening();
    await play(sine(110 * Math.pow(2, 2 / 1200)), 350);
    expect(cents()).toHaveTextContent("+2 cents · hold…");
    await play(sine(110 * Math.pow(2, 2 / 1200)), 1000);
    expect(cents()).toHaveTextContent("In tune");
  });

  it("applies a new A4 at once, without restarting", async () => {
    renderTools();
    const play = await startListening();
    await play(sine(440), 1300);
    expect(cents()).toHaveTextContent("In tune");
    fireEvent.click(screen.getByRole("button", { name: "Raise reference" }));
    // 440 Hz against A4 = 441 is 3.9 cents flat: out of tune straight away.
    expect(cents()).toHaveTextContent("-4 cents · tune up");
    await play(sine(440), 50);
    expect(cents()).toHaveTextContent("-4 cents · tune up");
    expect(document.querySelector(".tuner.in-tune")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop tuner" })).toBeInTheDocument();
  });

  it("applies a typed A4 while typing, without Enter", async () => {
    renderTools();
    fireEvent.change(a4(), { target: { value: "4" } });
    fireEvent.change(a4(), { target: { value: "43" } });
    expect(reset()).toBeNull(); // partial input: still 440
    expect(localStorage.getItem("stereo-set:tuner-a4")).toBeNull();
    fireEvent.change(a4(), { target: { value: "432" } });
    expect(reset()).not.toBeNull();
    expect(localStorage.getItem("stereo-set:tuner-a4")).toBe("432");
    expect(a4().value).toBe("432"); // no Enter, no blur
    const play = await startListening();
    await play(sine(432), 1300);
    expect(document.querySelector(".tuner-note")).toHaveTextContent("A4");
    expect(cents()).toHaveTextContent("In tune");
  });

  it("raises A4 with + and resets it to 440", () => {
    renderTools();
    expect(a4().value).toBe("440");
    expect(reset()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raise reference" }));
    expect(a4().value).toBe("441");
    fireEvent.click(reset()!);
    expect(a4().value).toBe("440");
    expect(reset()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lower reference" }));
    expect(a4().value).toBe("439");
  });

  it("takes a typed A4, clamps it, and remembers it on this device", () => {
    const { unmount } = renderTools();
    fireEvent.change(a4(), { target: { value: "432" } });
    fireEvent.keyDown(a4(), { key: "Enter" });
    expect(a4().value).toBe("432");
    unmount();
    renderTools();
    expect(a4().value).toBe("432");

    fireEvent.change(a4(), { target: { value: "999" } });
    fireEvent.blur(a4());
    expect(a4().value).toBe("466");
    expect(screen.getByRole("button", { name: "Raise reference" })).toBeDisabled();

    fireEvent.change(a4(), { target: { value: "" } });
    fireEvent.blur(a4());
    expect(a4().value).toBe("466");
  });

  it("falls back to 440 for an unreadable stored A4", () => {
    localStorage.setItem("stereo-set:tuner-a4", "banana");
    renderTools();
    expect(a4().value).toBe("440");
  });

  it("names notes against the chosen A4", async () => {
    localStorage.setItem("stereo-set:tuner-a4", "432");
    renderTools();
    const play = await startListening();
    await play(sine(432), 1300);
    expect(document.querySelector(".tuner-note")).toHaveTextContent("A4");
    expect(screen.getByText("In tune")).toBeInTheDocument();
  });

  it("hears a 5-string bass's low B", async () => {
    renderTools();
    const play = await startListening();
    await play(sine(30.87));
    expect(document.querySelector(".tuner-note")).toHaveTextContent("B0");
  });

  it("asks for the microphone only after Start, with voice processing off", async () => {
    renderTools();
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await screen.findByRole("button", { name: "Stop tuner" });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  });

  it("shows the note heard and its cents", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await act(async () => {});
    const ctx = FakeAudioContext.instances[0];
    ctx.input = sine(110); // A2, in tune once held for a second
    await listen(1300);
    expect(screen.getByText("In tune")).toBeInTheDocument();
    expect(document.querySelector(".tuner-note")).toHaveTextContent("A2");

    ctx.input = sine(110 * Math.pow(2, -20 / 1200)); // 20 cents flat
    await listen(1000);
    expect(cents()).toHaveTextContent("-20 cents · tune up");
    expect(cents().querySelector("strong")).toHaveTextContent("-20 cents");
    expect(lit()).toEqual(["♭ ◀"]);
  });

  it("turns the microphone off on Stop and when leaving the page", async () => {
    const { unmount } = renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop tuner" }));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await screen.findByRole("button", { name: "Stop tuner" });
    unmount();
    expect(track.stop).toHaveBeenCalledTimes(2);
  });

  it("explains a blocked microphone", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access was blocked");
    expect(screen.getByRole("button", { name: "Start tuner" })).toBeEnabled();
  });
});

describe("Metronome", () => {
  const bpm = () => document.querySelector(".metro-bpm")!.textContent;

  it("changes the tempo with the buttons and the slider, within 30-300", () => {
    renderTools();
    expect(bpm()).toBe("120");
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(bpm()).toBe("121");
    fireEvent.click(screen.getByRole("button", { name: "Slower" }));
    fireEvent.click(screen.getByRole("button", { name: "Slower" }));
    expect(bpm()).toBe("119");
    fireEvent.change(screen.getByRole("slider", { name: "Tempo" }), { target: { value: "300" } });
    expect(bpm()).toBe("300");
    expect(screen.getByRole("button", { name: "Faster" })).toBeDisabled();
  });

  it("sets the tempo from taps", () => {
    const now = vi.spyOn(performance, "now");
    renderTools();
    for (const t of [1000, 1500, 2000, 2500]) {
      now.mockReturnValue(t);
      fireEvent.click(screen.getByRole("button", { name: "Tap tempo" }));
    }
    expect(bpm()).toBe("120");
    now.mockRestore();
  });

  const loopsOf = (ctx: FakeAudioContext) =>
    ctx.loops.map((l) => ({
      when: +l.when!.toFixed(4),
      offset: +l.offset!.toFixed(4),
      loopEnd: +l.loopEnd.toFixed(4),
      stoppedAt: l.stoppedAt === undefined ? undefined : +l.stoppedAt.toFixed(4),
    }));

  it("plays one looped bar, which keeps going with no timers (screen off), and stops", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const ctx = FakeAudioContext.instances[0];
    // 3 beats at 120 BPM: a 1.5 s bar, looped by the audio engine from 0.05 s.
    expect(loopsOf(ctx)).toEqual([{ when: 0.05, offset: 0, loopEnd: 1.5, stoppedAt: undefined }]);
    expect(ctx.loops[0].loop).toBe(true);
    // The beat dots follow the audio clock.
    ctx.currentTime = 1.0;
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    expect(document.querySelectorAll(".metro-dot")).toHaveLength(3);
    expect(document.querySelectorAll(".metro-dot")[1]).toHaveClass("lit");
    expect(ctx.loops).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(ctx.loops[0].stoppedAt).toBeDefined();
    expect(ctx.suspend).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("changes tempo on the next beat, keeping its place in the bar", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime = 0.6; // beat 2 (index 1) sounded at 0.55; the next beat is index 2 at 1.05
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    const beat = 60 / 121;
    expect(loopsOf(ctx)).toEqual([
      { when: 0.05, offset: 0, loopEnd: 2, stoppedAt: 1.05 },
      { when: 1.05, offset: +(2 * beat).toFixed(4), loopEnd: +(4 * beat).toFixed(4), stoppedAt: undefined },
    ]);
  });

  it("starts a new bar on the next beat when beats per bar changes", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime = 0.6;
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(loopsOf(ctx)).toEqual([
      { when: 0.05, offset: 0, loopEnd: 2, stoppedAt: 1.05 },
      { when: 1.05, offset: 0, loopEnd: 1.5, stoppedAt: undefined },
    ]);
  });

  it("replaces a change that hasn't started yet instead of stacking them", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime = 0.6;
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    const playingAt = (t: number) =>
      ctx.loops.filter((l) => l.when! <= t && (l.stoppedAt === undefined || l.stoppedAt > t));
    // Only one loop sounds at any moment, and from 1.05 it is the 122 BPM one.
    expect(playingAt(0.8)).toHaveLength(1);
    expect(playingAt(1.2)).toHaveLength(1);
    expect(playingAt(1.2)[0].loopEnd).toBeCloseTo(4 * (60 / 122));
  });

  it("remembers tempo and beats per bar on this device", () => {
    const { unmount } = renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    unmount();
    renderTools();
    expect(bpm()).toBe("121");
    expect(screen.getByRole("button", { name: "6" })).toHaveAttribute("aria-pressed", "true");
  });
});
