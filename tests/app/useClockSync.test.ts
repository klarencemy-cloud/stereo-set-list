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
  it("takes 20 samples at the start, then 3 every 60 s", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(20);
    await advance(59_000);
    expect(getTime).toHaveBeenCalledTimes(20);
    await advance(1_000);
    expect(getTime).toHaveBeenCalledTimes(23);
  });

  it("takes no samples while hidden, and a round of 3 as soon as it is visible", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(180_000);
    expect(getTime).toHaveBeenCalledTimes(20);
    setHidden(false);
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(23);
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

  it("reports how fast the offset drifts, once there are 3 rounds", async () => {
    let perf = 0;
    vi.spyOn(performance, "now").mockImplementation(() => perf);
    // The server's clock gains 3 ms a minute on this phone's (50 ppm), and answers instantly.
    getTime.mockImplementation(async () => ({ now: perf + 1000 + perf * 0.00005 }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    expect(result.current.driftPerMs).toBe(0);
    for (let i = 0; i < 2; i++) {
      perf += 60_000;
      await advance(60_000);
    }
    expect(result.current.driftPerMs).toBeCloseTo(0.00005, 9);
    vi.restoreAllMocks();
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });

  it("reports no drift from rounds only seconds apart (screen toggled), however far the offset jumped", async () => {
    let perf = 0;
    let offset = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => perf);
    getTime.mockImplementation(async () => ({ now: perf + offset }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    for (let i = 0; i < 3; i++) {
      perf += 1000;
      offset += 40;
      setHidden(true);
      setHidden(false);
      await advance(0);
    }
    expect(result.current.status).toBe("synced");
    expect(result.current.driftPerMs).toBe(0);
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
    getTime.mockImplementation(async () => ({ now: perf + 1000 + perf * 0.0005 }));
    const { result } = renderHook(() => useClockSync(true));
    await advance(0);
    for (let i = 0; i < 2; i++) {
      perf += 60_000;
      await advance(60_000);
    }
    expect(result.current.driftPerMs).toBeCloseTo(0.0002, 12);
    vi.restoreAllMocks();
    getTime.mockImplementation(async () => ({ now: 1000 }));
  });
});
