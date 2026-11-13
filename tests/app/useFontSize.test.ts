import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFontSize, FONT_SIZE_KEY } from "../../src/app/components/useFontSize";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useFontSize", () => {
  it("starts at 15px", () => {
    const { result } = renderHook(() => useFontSize());
    expect(result.current.size).toBe(15);
  });

  it("steps through the sizes and saves them", () => {
    const { result } = renderHook(() => useFontSize());
    act(() => result.current.bigger());
    expect(result.current.size).toBe(17);
    expect(localStorage.getItem(FONT_SIZE_KEY)).toBe("17");
    act(() => result.current.smaller());
    act(() => result.current.smaller());
    expect(result.current.size).toBe(13);
    expect(result.current.canShrink).toBe(false);
    act(() => result.current.smaller());
    expect(result.current.size).toBe(13);
  });

  it("stops at 28px", () => {
    localStorage.setItem(FONT_SIZE_KEY, "28");
    const { result } = renderHook(() => useFontSize());
    expect(result.current.size).toBe(28);
    expect(result.current.canGrow).toBe(false);
    act(() => result.current.bigger());
    expect(result.current.size).toBe(28);
  });

  it("reads a saved size", () => {
    localStorage.setItem(FONT_SIZE_KEY, "20");
    const { result } = renderHook(() => useFontSize());
    expect(result.current.size).toBe(20);
  });

  it("ignores a saved value that is not one of the sizes", () => {
    for (const bad of ["abc", "999", "16", ""]) {
      localStorage.setItem(FONT_SIZE_KEY, bad);
      const { result, unmount } = renderHook(() => useFontSize());
      expect(result.current.size).toBe(15);
      unmount();
    }
  });

  it("works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useFontSize());
    expect(result.current.size).toBe(15);
    act(() => result.current.bigger());
    expect(result.current.size).toBe(17);
  });
});
