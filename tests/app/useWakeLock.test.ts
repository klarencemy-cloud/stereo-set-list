import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWakeLock } from "../../src/app/components/useWakeLock";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function mockWakeLock() {
  const release = vi.fn(async () => {});
  const request = vi.fn(async () => ({ release }));
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { request, release };
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("useWakeLock", () => {
  it("asks for the wake lock again when the page becomes visible while active", async () => {
    const { request } = mockWakeLock();
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => setVisibility("hidden"));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => setVisibility("visible"));
    expect(request).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does not ask again after it is turned off, and releases the lock", async () => {
    const { request, release } = mockWakeLock();
    const { rerender } = renderHook(({ running }) => useWakeLock(running), { initialProps: { running: true } });
    await act(async () => {});
    rerender({ running: false });
    expect(release).toHaveBeenCalled();
    await act(async () => setVisibility("visible"));
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("useWakeLock without browser support", () => {
  it("does nothing when the browser has no wake lock", async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => setVisibility("visible"));
    unmount();
  });
});
