import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ApiError } from "../../src/app/api";
import { useVersionedRecord } from "../../src/app/components/useVersionedRecord";

interface Rec {
  id: string;
  updatedAt: string;
  key: string;
  bpm: number;
}

const rec: Rec = { id: "s1", updatedAt: "v1", key: "A", bpm: 90 };

function setup(send: (id: string, patch: Partial<Rec>, base?: string) => Promise<Rec>, onStored?: (r: Rec) => void) {
  const hook = renderHook(() => useVersionedRecord<Rec, Partial<Rec>>(send, { onStored }));
  act(() => hook.result.current.load(rec));
  return hook;
}

describe("useVersionedRecord", () => {
  it("sends the change with the loaded version and keeps the copy the server saved", async () => {
    const send = vi.fn(async () => ({ ...rec, key: "Bb", updatedAt: "v2" }));
    const { result } = setup(send);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save({ key: "Bb" }, "Could not save.");
    });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith("s1", { key: "Bb" }, "v1");
    expect(result.current.record).toEqual({ ...rec, key: "Bb", updatedAt: "v2" });
  });

  it("shows the change at once, before the server answers, and says it is saving", async () => {
    const { result } = setup(() => new Promise(() => {}));
    act(() => {
      void result.current.save({ key: "Bb" }, "Could not save.");
    });
    expect(result.current.record?.key).toBe("Bb");
    expect(result.current.saving).toBe(true);
  });

  it("puts the copy back and gives the fallback message when the save fails", async () => {
    const { result } = setup(async () => {
      throw new TypeError("network");
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save({ key: "Bb" }, "Could not save the new key.");
    });
    expect(ok).toBe(false);
    expect(result.current.record).toEqual(rec);
    expect(result.current.error).toBe("Could not save the new key.");
    expect(result.current.conflict).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("prefers the server's message", async () => {
    const { result } = setup(async () => {
      throw new ApiError(500, "The server is down.");
    });
    await act(async () => {
      await result.current.save({ key: "Bb" }, "Could not save.");
    });
    expect(result.current.error).toBe("The server is down.");
  });

  it("on a conflict, keeps this copy until Reload, which shows the bandmate's version", async () => {
    const theirs: Rec = { ...rec, key: "C", updatedAt: "v9" };
    const onStored = vi.fn();
    const { result } = setup(async () => {
      throw new ApiError(409, "Someone else changed this song.", theirs);
    }, onStored);
    await act(async () => {
      await result.current.save({ key: "Bb" }, "Could not save.");
    });
    expect(result.current.record).toEqual(rec);
    expect(result.current.conflict).toEqual(theirs);
    expect(result.current.error).toBe("Someone else changed this song.");
    expect(onStored).not.toHaveBeenCalled();

    act(() => result.current.reload());
    expect(result.current.record).toEqual(theirs);
    expect(result.current.conflict).toBeNull();
    expect(result.current.error).toBe("");
    expect(onStored).toHaveBeenCalledWith(theirs);
  });

  it("tells onStored about every saved copy", async () => {
    const saved = { ...rec, key: "Bb", updatedAt: "v2" };
    const onStored = vi.fn();
    const { result } = setup(async () => saved, onStored);
    await act(async () => {
      await result.current.save({ key: "Bb" }, "Could not save.");
    });
    expect(onStored).toHaveBeenCalledWith(saved);
  });

  it("refuses a second save while one is running, and the next save sends the new version", async () => {
    let finish!: (r: Rec) => void;
    const send = vi.fn((_id: string, patch: Partial<Rec>) =>
      send.mock.calls.length === 1 ? new Promise<Rec>((r) => (finish = r)) : Promise.resolve({ ...rec, ...patch, updatedAt: "v3" }),
    );
    const { result } = setup(send);
    let first!: Promise<boolean>;
    let second: boolean | undefined;
    act(() => {
      first = result.current.save({ key: "Bb" }, "Could not save.");
    });
    await act(async () => {
      second = await result.current.save({ bpm: 120 }, "Could not save.");
    });
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ ...rec, key: "Bb", updatedAt: "v2" });
      await first;
    });
    await act(async () => {
      await result.current.save({ bpm: 120 }, "Could not save.");
    });
    expect(send).toHaveBeenLastCalledWith("s1", { bpm: 120 }, "v2");
  });

  describe("after moving to another record while a save runs", () => {
    const other: Rec = { id: "s2", updatedAt: "w1", key: "D", bpm: 70 };

    it("keeps showing the new record when the old save answers, but still reports the stored copy", async () => {
      let finish!: (r: Rec) => void;
      const onStored = vi.fn();
      const { result } = setup(() => new Promise<Rec>((r) => (finish = r)), onStored);
      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.save({ key: "Bb" }, "Could not save.");
      });
      act(() => result.current.load(other));
      const saved = { ...rec, key: "Bb", updatedAt: "v2" };
      await act(async () => {
        finish(saved);
        await pending;
      });
      expect(result.current.record).toEqual(other);
      expect(onStored).toHaveBeenCalledWith(saved);
    });

    it("lets the new record save straight away: the old save only holds up its own record", async () => {
      const send = vi.fn((id: string) =>
        id === "s1" ? new Promise<Rec>(() => {}) : Promise.resolve({ ...other, key: "E", updatedAt: "w2" }),
      );
      const { result } = setup(send);
      act(() => {
        void result.current.save({ key: "Bb" }, "Could not save.");
      });
      act(() => result.current.load(other));
      expect(result.current.saving).toBe(false);
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.save({ key: "E" }, "Could not save.");
      });
      expect(ok).toBe(true);
      expect(result.current.record).toEqual({ ...other, key: "E", updatedAt: "w2" });
    });

    it("shows no error or conflict when the old save fails", async () => {
      let fail!: (e: unknown) => void;
      const { result } = setup(() => new Promise<Rec>((_, j) => (fail = j)));
      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.save({ key: "Bb" }, "Could not save.");
      });
      act(() => result.current.load(other));
      await act(async () => {
        fail(new ApiError(409, "Someone else changed this song.", { ...rec, updatedAt: "v9" }));
        await pending;
      });
      expect(result.current.record).toEqual(other);
      expect(result.current.error).toBe("");
      expect(result.current.conflict).toBeNull();
    });
  });

  it("loading a record clears an earlier error and conflict", async () => {
    const { result } = setup(async () => {
      throw new ApiError(409, "Someone else changed this song.", { ...rec, updatedAt: "v9" });
    });
    await act(async () => {
      await result.current.save({ key: "Bb" }, "Could not save.");
    });
    act(() => result.current.load({ ...rec, id: "s2" }));
    expect(result.current.error).toBe("");
    expect(result.current.conflict).toBeNull();
  });

  it("dismiss clears the error and conflict but keeps the copy", async () => {
    const { result } = setup(async () => {
      throw new ApiError(409, "Someone else changed this song.", { ...rec, updatedAt: "v9" });
    });
    await act(async () => {
      await result.current.save({ key: "Bb" }, "Could not save.");
    });
    act(() => result.current.dismiss());
    expect(result.current.error).toBe("");
    expect(result.current.conflict).toBeNull();
    expect(result.current.record).toEqual(rec);
  });
});
