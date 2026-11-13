import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStageMode } from "../../src/app/components/useStageMode";

let fullscreenElement: Element | null = null;

function stubFullscreen(request: () => Promise<void> = () => Promise.resolve()) {
  const requestFullscreen = vi.fn(() => {
    const p = request();
    fullscreenElement = document.documentElement;
    return p;
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    return Promise.resolve();
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: requestFullscreen, configurable: true });
  Object.defineProperty(document, "exitFullscreen", { value: exitFullscreen, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { get: () => fullscreenElement, configurable: true });
  return { requestFullscreen, exitFullscreen };
}

beforeEach(() => {
  fullscreenElement = null;
  document.body.className = "";
});
afterEach(() => {
  // jsdom has none of these natively: remove the stubs again.
  for (const [obj, key] of [
    [document.documentElement, "requestFullscreen"],
    [document, "exitFullscreen"],
    [document, "fullscreenElement"],
  ] as const) {
    delete (obj as unknown as Record<string, unknown>)[key];
  }
});

describe("useStageMode", () => {
  it("adds the stage body class and asks for fullscreen, then undoes both", () => {
    const { requestFullscreen, exitFullscreen } = stubFullscreen();
    const { result } = renderHook(() => useStageMode());
    expect(result.current.on).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(document.body.classList.contains("stage")).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    act(() => result.current.toggle());
    expect(result.current.on).toBe(false);
    expect(document.body.classList.contains("stage")).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("does not call exitFullscreen when the page is not in fullscreen", () => {
    const { exitFullscreen } = stubFullscreen();
    const { result } = renderHook(() => useStageMode());
    act(() => result.current.toggle());
    fullscreenElement = null;
    act(() => result.current.toggle());
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("still works when the browser has no Fullscreen API", () => {
    const { result } = renderHook(() => useStageMode());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(document.body.classList.contains("stage")).toBe(true);
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(document.body.classList.contains("stage")).toBe(false);
  });

  it("swallows a rejected fullscreen request and stays in stage mode", async () => {
    stubFullscreen(() => Promise.reject(new Error("denied")));
    const { result } = renderHook(() => useStageMode());
    await act(async () => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(document.body.classList.contains("stage")).toBe(true);
  });

  it("swallows a fullscreen request that throws", () => {
    const requestFullscreen = vi.fn(() => {
      throw new Error("nope");
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: requestFullscreen, configurable: true });
    const { result } = renderHook(() => useStageMode());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.on).toBe(true);
  });

  it("turns off when the browser leaves fullscreen after the hook entered it", () => {
    stubFullscreen();
    const { result } = renderHook(() => useStageMode());
    act(() => result.current.toggle());
    act(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.on).toBe(false);
    expect(document.body.classList.contains("stage")).toBe(false);
  });

  it("stays on when fullscreen changes but the hook never entered it", () => {
    const { result } = renderHook(() => useStageMode());
    act(() => result.current.toggle());
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.on).toBe(true);
  });

  it("removes the class on unmount", () => {
    stubFullscreen();
    const { result, unmount } = renderHook(() => useStageMode());
    act(() => result.current.toggle());
    unmount();
    expect(document.body.classList.contains("stage")).toBe(false);
  });
});
