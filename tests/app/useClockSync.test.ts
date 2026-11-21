import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getTime: vi.fn() } };
});

import { api } from "../../src/app/api";
import { useClockSync } from "../../src/app/metronome/useClockSync";

const getTime = api.getTime as unknown as ReturnType<typeof vi.fn>;

/** This phone's performance.now(). */
let perf = 0;
/** The server's clock at a performance.now() time (default: 1000 ms ahead). */
let server = (t: number) => t + 1000;

/** Moves performance.now() and the timers forward together, in 20 ms steps (every network delay here is a multiple). */
const advance = async (ms: number) => {
  for (let left = ms; left > 0; left -= 20) {
    const d = Math.min(20, left);
    perf += d;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(d);
    });
  }
  if (ms === 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
};
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  perf = 0;
  server = (t) => t + 1000;
  vi.spyOn(performance, "now").mockImplementation(() => perf);
  getTime.mockReset();
  // Answers instantly with the server's time.
  getTime.mockImplementation(async () => ({ now: server(perf) }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
});

describe("useClockSync", () => {
  it("takes 20 time calls at the start, then 3 every 60 s", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(20);
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 1000 });
    await advance(60_000);
    expect(getTime).toHaveBeenCalledTimes(23);
    await advance(120_000);
    expect(getTime).toHaveBeenCalledTimes(29);
  });

  it("takes no time calls while the page is hidden, and a round as soon as it is visible again", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(180_000);
    expect(getTime).toHaveBeenCalledTimes(20);
    setHidden(false);
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(23);
  });

  it("closing (unmounting) during the first round stops its time calls", async () => {
    getTime.mockImplementation(() => new Promise((r) => setTimeout(() => r({ now: 1000 }), 100)));
    const { unmount } = renderHook(() => useClockSync(true));
    await advance(250);
    unmount();
    await advance(5000);
    expect(getTime).toHaveBeenCalledTimes(3);
  });

  it("keeps its estimate across hidden time", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(120_000);
    expect(result.current.status).toBe("synced");
  });

  it("stops its time calls when no longer active", async () => {
    const { rerender } = renderHook(({ on }) => useClockSync(on), { initialProps: { on: true } });
    await advance(0);
    rerender({ on: false });
    await advance(120_000);
    expect(getTime).toHaveBeenCalledTimes(20);
  });

  it("says it failed when no time call of the first round is answered", async () => {
    getTime.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.status).toBe("failed");
  });

  it("lets a fast sample age out after 3 rounds, so a slow patch of network doesn't stick", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current).toMatchObject({ offsetMs: 1000, rttMs: 0 });
    // Then every call takes 40 ms there and back, and the server's clock has moved to 1100 ahead.
    server = (t) => t + 1100;
    getTime.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ now: server(perf - 20) }), 40)),
    );
    await advance(120_000);
    expect(result.current).toMatchObject({ offsetMs: 1000, rttMs: 0 }); // the first round is still kept
    // Each round starts 60 s after the last one landed: the third slow round lands just after 3 minutes.
    await advance(62_000);
    expect(result.current.rttMs).toBe(40);
    expect(result.current.offsetMs).toBeCloseTo(1100, 6);
  });

  it("reports how fast the offset drifts once the rounds span 2 minutes", async () => {
    // The server's clock gains 3 ms a minute on this phone's (50 ppm).
    server = (t) => t + 1000 + t * 0.00005;
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.driftPerMs).toBe(0);
    await advance(120_000);
    expect(result.current.driftPerMs).toBeCloseTo(0.00005, 9);
  });

  it("caps the drift at what a clock can really do (200 ppm)", async () => {
    // 30 ms a minute (500 ppm): a bad network patch, not a clock.
    server = (t) => t + 1000 + t * 0.0005;
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    await advance(120_000);
    expect(result.current.driftPerMs).toBeCloseTo(0.0002, 12);
  });
});

describe("useClockSync after the phone slept (H7)", () => {
  /** The phone sleeps: performance.now() stands still while the server's clock and the wall clock run on. */
  function sleep(ms: number) {
    const before = server;
    server = (t) => before(t) + ms;
    vi.setSystemTime(Date.now() + ms);
  }

  it("drops the samples from before the sleep and takes a full round, standing in with the moved estimate", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.offsetMs).toBe(1000);
    setHidden(true);
    await advance(5000);
    sleep(30_000);
    // The calls after waking are slow (100 ms each way), so any sample from before the sleep would win if kept.
    getTime.mockImplementation(() => new Promise((r) => setTimeout(() => r({ now: server(perf - 100) }), 200)));
    setHidden(false);
    // Until the new round lands, the old estimate moved by the pause.
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 31_000 });
    await advance(5000);
    expect(getTime).toHaveBeenCalledTimes(40);
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 31_000, rttMs: 200 });
  });

  it("after waking with no network, keeps the moved estimate instead of failing", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    sleep(30_000);
    getTime.mockRejectedValue(new Error("offline"));
    setHidden(false);
    await advance(1000);
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 31_000 });
  });

  it("a page hidden without sleeping keeps its samples and takes the usual 3 calls", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(10_000);
    setHidden(false);
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(23);
    expect(result.current).toMatchObject({ offsetMs: 1000, rttMs: 0 });
  });
});
