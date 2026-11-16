// @vitest-environment jsdom
// The test world's network: the real api client's metronome and time calls go through a faked fetch to the
// real Netlify handlers, after a one-way delay each way.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api, ApiError } from "../../src/app/api";
import { advance, serverNow, setupWorld, teardownWorld, world } from "./harness";

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
    await advance(50, 1);
    expect(put.value).toMatchObject({ bpm: 132, beatsPerBar: 4, running: true });
    expect(await w.stored()).toEqual(put.value);

    const get = watch(api.getMetronome(w.song.id));
    await advance(30, 1);
    expect(get.value).toEqual(put.value);
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
    const r = watch(api.getMetronome(w.song.id));
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
