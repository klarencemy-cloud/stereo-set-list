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
import { INSTRUMENTS, analysisSize } from "../../src/app/tuner/pitch";

/** A stand-in AudioContext that records the clicks booked and lets tests move its clock. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  state = "running";
  started: number[] = [];
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
  const strings = () => within(screen.getByRole("list", { name: "Strings" })).getAllByRole("listitem").map((li) => li.textContent);

  it("switches between guitar and bass strings, and remembers the choice", () => {
    const { unmount } = renderTools();
    expect(strings()).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    fireEvent.click(screen.getByRole("button", { name: "Bass" }));
    expect(strings()).toEqual(["E1", "A1", "D2", "G2"]);
    expect(screen.getByRole("button", { name: "Bass" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    renderTools();
    expect(strings()).toEqual(["E1", "A1", "D2", "G2"]);
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

  it("shows the note heard, its cents and the nearest string", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "Start tuner" }));
    await act(async () => {});
    const ctx = FakeAudioContext.instances[0];
    ctx.input = sine(INSTRUMENTS.guitar.strings[1].freq); // A2, in tune
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText("In tune")).toBeInTheDocument();
    expect(document.querySelector(".tuner-note")).toHaveTextContent("A2");
    expect(document.querySelector(".tuner-string.near")).toHaveTextContent("A2");

    ctx.input = sine(110 * Math.pow(2, -20 / 1200)); // 20 cents flat
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText(/-20 cents \(flat, tune up\)/)).toBeInTheDocument();
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

  it("starts and stops, booking accented clicks ahead on the audio clock", async () => {
    vi.useFakeTimers();
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.started).toEqual([0.05]);
    ctx.currentTime = 1.0;
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    expect(ctx.started).toEqual([0.05, 0.55, 1.05]);
    // The beat dots follow the booked beats.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(document.querySelectorAll(".metro-dot")).toHaveLength(3);
    expect(document.querySelector(".metro-dot.lit")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(ctx.suspend).toHaveBeenCalled();
    ctx.currentTime = 5;
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(ctx.started).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
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
