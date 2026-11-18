import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getTime: vi.fn(async () => ({ now: 1000 })) } };
});

import { api } from "../../src/app/api";
import { useClockSync } from "../../src/app/metronome/useClockSync";

const getTime = api.getTime as unknown as ReturnType<typeof vi.fn>;

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
  getTime.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
});

describe("useClockSync", () => {
  it("takes 20 samples at the start, then no more time calls", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(20);
    await advance(600_000);
    expect(getTime).toHaveBeenCalledTimes(20);
  });

  it("takes no time calls when the page is visible again (the session checks bring samples)", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(180_000);
    setHidden(false);
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(20);
  });

  it("closing (unmounting) during the first round stops its time calls", async () => {
    getTime.mockImplementation(() => new Promise((r) => setTimeout(() => r({ now: 1000 }), 100)));
    const { unmount } = renderHook(() => useClockSync(true));
    await advance(250);
    unmount();
    await advance(5000);
    expect(getTime).toHaveBeenCalledTimes(3);
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });

  it("keeps its estimate across hidden time", async () => {
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(120_000);
    expect(result.current.status).toBe("synced");
  });

  it("stops sampling when no longer active", async () => {
    const { rerender } = renderHook(({ on }) => useClockSync(on), { initialProps: { on: true } });
    await advance(0);
    rerender({ on: false });
    await advance(120_000);
    expect(getTime).toHaveBeenCalledTimes(20);
  });

  it("reports how fast the offset drifts, once the samples handed in span 3 rounds", async () => {
    let perf = 0;
    vi.spyOn(performance, "now").mockImplementation(() => perf);
    // The server's clock gains 3 ms a minute on this phone's (50 ppm), and answers instantly.
    const server = (t: number) => t + 1000 + t * 0.00005;
    getTime.mockImplementation(async () => ({ now: server(perf) }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.driftPerMs).toBe(0);
    // A session check every 1.5 s, for 2 minutes.
    for (let t = 1500; t <= 120_000; t += 1500) {
      act(() => result.current.addSample({ sentMs: t, serverMs: server(t), receivedMs: t }));
    }
    expect(result.current.driftPerMs).toBeCloseTo(0.00005, 9);
    vi.restoreAllMocks();
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });

  it("lets a fast sample age out after a few minutes, so a slow patch of network doesn't stick", async () => {
    let perf = 0;
    vi.spyOn(performance, "now").mockImplementation(() => perf);
    // The first round: instant answers, offset 1000.
    getTime.mockImplementation(async () => ({ now: perf + 1000 }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current).toMatchObject({ offsetMs: 1000, rttMs: 0 });
    // Then the checks bring slower samples (40 ms network round trip) of a clock that has moved to offset 1100.
    for (let t = 1500; t <= 300_000; t += 1500) {
      act(() => result.current.addSample({ sentMs: t, serverMs: t + 20 + 1100, receivedMs: t + 40 }));
    }
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 1100, rttMs: 40 });
    vi.restoreAllMocks();
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });

  it("takes samples handed in from other answers, and syncs from them even when every time call failed", async () => {
    getTime.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.status).toBe("failed");
    act(() => result.current.addSample({ sentMs: 100, serverMs: 5130, receivedMs: 160 }));
    expect(result.current).toMatchObject({ status: "synced", offsetMs: 5000, rttMs: 60 });
    // A faster one wins.
    act(() => result.current.addSample({ sentMs: 200, serverMs: 5205, receivedMs: 210 }));
    expect(result.current).toMatchObject({ offsetMs: 5000, rttMs: 10 });
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });

  it("caps the drift at what a clock can really do (200 ppm)", async () => {
    let perf = 0;
    vi.spyOn(performance, "now").mockImplementation(() => perf);
    // 30 ms a minute (500 ppm): a bad network patch, not a clock.
    const server = (t: number) => t + 1000 + t * 0.0005;
    getTime.mockImplementation(async () => ({ now: server(perf) }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    for (let t = 1500; t <= 120_000; t += 1500) {
      act(() => result.current.addSample({ sentMs: t, serverMs: server(t), receivedMs: t }));
    }
    expect(result.current.driftPerMs).toBeCloseTo(0.0002, 12);
    vi.restoreAllMocks();
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });
});
