// @vitest-environment jsdom
// The test world's network: the real api client's metronome and time calls go through a faked fetch to the
// real Netlify handlers, after a one-way delay each way (plus any server work). Its screen keep-on fake, through the
// real useWakeLock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWakeLock } from "../../src/app/components/useWakeLock";
import { api, ApiError } from "../../src/app/api";
import { advance, dropWakeLock, serverNow, setHidden, setupWorld, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
});
afterEach(teardownWorld);

/** Tracks a promise's outcome without awaiting it, so the virtual clock can be advanced meanwhile. */
function watch<T>(p: Promise<T>) {
  const out: { done: boolean; value?: T; error?: unknown } = { done: false };
  p.then(
    (value) => Object.assign(out, { done: true, value }),
    (error) => Object.assign(out, { done: true, error }),
  );
  return out;
}

describe("the world's network", () => {
  it("answers getTime with the server's clock, read when the request arrives", async () => {
    world.latency = { getTime: [30, 70] };
    const sentAt = serverNow();
    const r = watch(api.getTime());
    expect(world.sent.getTime).toBe(1);
    await advance(99, 1);
    expect(r.done).toBe(false);
    await advance(5, 1);
    expect(r.value).toEqual({ now: sentAt + 30 });
    expect(world.served.getTime).toEqual([sentAt + 30]);
  });

  it("sends putMetronome to the real handler, and getMetronome reads what it stored", async () => {
    world.latency = { putMetronome: [20, 20], getMetronome: [10, 10] };
    const put = watch(api.putMetronome(w.song.id, { bpm: 132, beatsPerBar: 4, running: true }));
    const putAt = serverNow() + 20; // the server answers when the request arrives
    await advance(50, 1);
    expect(put.value).toMatchObject({ session: { bpm: 132, beatsPerBar: 4, running: true }, now: putAt });
    expect(await w.stored()).toEqual(put.value!.session);

    const getAt = serverNow() + 10;
    const get = watch(api.getMetronome(w.song.id));
    await advance(30, 1);
    expect(get.value).toEqual({ session: put.value!.session, now: getAt });
  });

  it("turns a handler's refusal into the api's ApiError with the server's status and message", async () => {
    const r = watch(api.getMetronome("no-such-song"));
    await advance(5, 1);
    expect(r.error).toBeInstanceOf(ApiError);
    expect((r.error as ApiError).status).toBe(404);
    expect((r.error as ApiError).message).toBe("song not found");
  });

  it("fails at once while offline, as fetch does with no network", async () => {
    world.offline = true;
    const r = watch(api.getTime());
    await advance(1, 1);
    expect(r.error).toBeInstanceOf(ApiError);
    expect((r.error as ApiError).status).toBe(0);
    expect(world.served.getTime).toEqual([]);
  });

  it("never answers while hung", async () => {
    world.hang = true;
    // Through fetch itself: the API client gives up on a metronome call after METRONOME_TIMEOUT_MS.
    const r = watch(fetch(`/api/metronome/${w.song.id}`));
    await advance(60_000, 100);
    expect(r.done).toBe(false);
    expect(world.served.getMetronome).toEqual([]);
  });

  it("rejects a hung request with an AbortError when its signal aborts, as fetch does", async () => {
    world.hang = true;
    const ctrl = new AbortController();
    const aborted = watch(fetch(`/api/metronome/${w.song.id}`, { signal: ctrl.signal }));
    await advance(10, 1);
    ctrl.abort();
    await advance(1, 1);
    expect((aborted.error as DOMException).name).toBe("AbortError");
  });
});

describe("the world's server work", () => {
  it("reads the server's clock for an answer only after the work set for its endpoint", async () => {
    world.latency = { getMetronome: [10, 10] };
    world.serverWork = { getMetronome: 40 };
    const sentAt = serverNow();
    const answer = watch(api.getMetronome(w.song.id));
    await advance(70);
    expect(answer.done).toBe(true);
    expect(answer.value!.now).toBe(sentAt + 50);
  });
});

describe("the world's screen keep-on", () => {
  it("grants the request and holds it until the page lets go", async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await advance(10, 1);
    expect(world.wakeLock.requests).toBe(1);
    expect(world.wakeLock.held).toBe(1);
    unmount();
    await advance(10, 1);
    expect(world.wakeLock.held).toBe(0);
  });

  it("refuses the request when the test says so, as a battery saver does", async () => {
    world.wakeLock.refuse = true;
    renderHook(() => useWakeLock(true));
    await advance(10, 1);
    expect(world.wakeLock.requests).toBe(1);
    expect(world.wakeLock.held).toBe(0);
  });

  it("can drop a held lock while the page is visible, telling the page with a release event", async () => {
    // Asked for directly: useWakeLock would ask again as soon as it is dropped.
    await navigator.wakeLock.request("screen");
    const released = vi.fn();
    world.wakeLock.sentinels[0].addEventListener("release", released);
    dropWakeLock();
    expect(document.visibilityState).toBe("visible");
    expect(world.wakeLock.held).toBe(0);
    expect(world.wakeLock.sentinels[0].released).toBe(true);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("drops the lock when the page is hidden, and refuses it while hidden, as browsers do", async () => {
    renderHook(() => useWakeLock(true));
    await advance(10, 1);
    setHidden(true);
    expect(world.wakeLock.held).toBe(0);
    await expect(navigator.wakeLock.request("screen")).rejects.toMatchObject({ name: "NotAllowedError" });
    setHidden(false);
    await advance(10, 1);
    expect(world.wakeLock.held).toBe(1);
  });
});
