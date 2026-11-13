import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_SPEED, SPEEDS, speedKey, useSongSpeed } from "../../src/app/components/useSongSpeed";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useSongSpeed", () => {
  it("exposes the speeds and key", () => {
    expect(SPEEDS).toEqual([0.5, 1, 1.5, 2, 3]);
    expect(DEFAULT_SPEED).toBe(1);
    expect(speedKey("s1")).toBe("stereo-set:scroll-speed:s1");
  });

  it("starts at 1, and cycle saves the next speed for that song", () => {
    const { result } = renderHook(() => useSongSpeed("s1"));
    expect(result.current.speed).toBe(1);
    act(() => result.current.cycle());
    expect(result.current.speed).toBe(1.5);
    expect(localStorage.getItem(speedKey("s1"))).toBe("1.5");
  });

  it("wraps round to 0.5 after 3", () => {
    localStorage.setItem(speedKey("s1"), "3");
    const { result } = renderHook(() => useSongSpeed("s1"));
    expect(result.current.speed).toBe(3);
    act(() => result.current.cycle());
    expect(result.current.speed).toBe(0.5);
  });

  it("switches to the new song's saved speed instead of carrying the old one over", () => {
    localStorage.setItem(speedKey("s1"), "2");
    const { result, rerender } = renderHook(({ id }) => useSongSpeed(id), { initialProps: { id: "s1" } });
    expect(result.current.speed).toBe(2);
    rerender({ id: "s2" });
    expect(result.current.speed).toBe(1);
    rerender({ id: "s1" });
    expect(result.current.speed).toBe(2);
  });

  it("never renders the previous song's speed for the new song, even for one render", () => {
    localStorage.setItem(speedKey("s1"), "3");
    const seen: number[] = [];
    const { rerender } = renderHook(
      ({ id }) => {
        const r = useSongSpeed(id);
        seen.push(r.speed);
        return r;
      },
      { initialProps: { id: "s1" } },
    );
    seen.length = 0;
    rerender({ id: "s2" });
    expect(seen.every((v) => v === 1)).toBe(true);
  });

  it("ignores stored values that are not a known speed", () => {
    localStorage.setItem(speedKey("s1"), "7");
    expect(renderHook(() => useSongSpeed("s1")).result.current.speed).toBe(1);
    localStorage.setItem(speedKey("s2"), "abc");
    expect(renderHook(() => useSongSpeed("s2")).result.current.speed).toBe(1);
  });

  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSongSpeed("s1"));
    expect(result.current.speed).toBe(1);
    act(() => result.current.cycle());
    expect(result.current.speed).toBe(1.5);
  });
});
