import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoscroll } from "../../src/app/components/useAutoscroll";

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

describe("useAutoscroll wake lock", () => {
  it("asks for the wake lock again when the page becomes visible while running", async () => {
    const { request } = mockWakeLock();
    const { unmount } = renderHook(() => useAutoscroll(1, true));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => setVisibility("hidden"));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => setVisibility("visible"));
    expect(request).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does not ask again after autoscroll stops, and releases the lock", async () => {
    const { request, release } = mockWakeLock();
    const { rerender } = renderHook(({ running }) => useAutoscroll(1, running), { initialProps: { running: true } });
    await act(async () => {});
    rerender({ running: false });
    expect(release).toHaveBeenCalled();
    await act(async () => setVisibility("visible"));
    expect(request).toHaveBeenCalledTimes(1);
  });
});
