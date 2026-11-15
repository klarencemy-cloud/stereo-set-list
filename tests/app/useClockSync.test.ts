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
  it("takes 10 samples at the start, then 3 every 60 s", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(10);
    await advance(59_000);
    expect(getTime).toHaveBeenCalledTimes(10);
    await advance(1_000);
    expect(getTime).toHaveBeenCalledTimes(13);
  });

  it("takes no samples while hidden, and a round of 3 as soon as it is visible", async () => {
    renderHook(() => useClockSync(true));
    await advance(0);
    setHidden(true);
    await advance(180_000);
    expect(getTime).toHaveBeenCalledTimes(10);
    setHidden(false);
    await advance(0);
    expect(getTime).toHaveBeenCalledTimes(13);
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
    expect(getTime).toHaveBeenCalledTimes(10);
  });
});
