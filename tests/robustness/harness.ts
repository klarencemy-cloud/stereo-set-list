// Shared test world for the synced-metronome robustness tests (not a test file itself).
//
// One virtual clock drives everything: this phone's performance.now(), the fake timers, Date (the phone's wall
// clock) and the fake AudioContext's currentTime. A fake network replaces fetch: the real api client's metronome
// and time requests reach the REAL Netlify handlers (over the real repo on memoryKV) after a configurable one-way
// delay each way, so out-of-order and slow answers come from timing, not from hand-written mock answers. The
// fakes follow tests/app/SongMetronome.test.tsx (fake AudioContext and buffer sources, fake timers) but record
// enough to say what a listener would hear.
//
// Only the song calls are mocked (answered straight from the repo). A test file that renders the app declares
// that mock itself (vi.mock is hoisted per file), keeping the real metronome and time calls:
//   vi.mock("../../src/app/api", async () => {
//     const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
//     return { ...actual, api: { ...actual.api, updateSong: vi.fn(), getSong: vi.fn() } };
//   });
import { vi } from "vitest";
import { act } from "@testing-library/react";
import { api, ApiError } from "../../src/app/api";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo } from "../../netlify/functions/lib/repo";
import { makeMetronomeHandler } from "../../netlify/functions/metronome";
import { makeTimeHandler } from "../../netlify/functions/time";
import type { MetroChange } from "../../src/shared/metronome";
import type { Song, SongInput } from "../../src/shared/types";

/** Server time (ms since epoch) when this phone's performance.now() reads 0. */
export const SERVER_AT_PERF_0 = Date.UTC(2026, 10, 15, 18, 0, 0);
/** Length of one rendered click (src/app/metronome/loop.ts CLICK_S). */
export const CLICK_S = 0.05;

type Leg = [up: number, down: number];
type Endpoint = "getTime" | "getMetronome" | "putMetronome";

export const world = {
  /** This phone's performance.now(). */
  perf: 0,
  /** server = perf·(1 + driftPpm·1e-6) + serverAhead. Raise it to model performance.now() pausing while the server runs. */
  serverAhead: SERVER_AT_PERF_0,
  /** How much faster the server's clock runs than this phone's performance.now(), in ppm. */
  driftPpm: 0,
  /** One-way delays in ms, per endpoint. A function is called once per request. */
  latency: {} as Partial<Record<Endpoint, Leg | (() => Leg)>>,
  /** Requests to anything but the metronome and time endpoints (a mistake in the test world). */
  unrouted: [] as string[],
  /** Every request fails at once, as fetch does with no network. */
  offline: false,
  /** Requests never answer (a dead Wi-Fi that still looks connected). */
  hang: false,
  /** Server-side moments each endpoint was read/written at (server ms), in order. */
  served: { getTime: [] as number[], getMetronome: [] as number[], putMetronome: [] as number[] },
  /** Requests sent, per endpoint (counted when the phone sends, not when the server answers). */
  sent: { getTime: 0, getMetronome: 0, putMetronome: 0 },
};

export const serverNow = () => world.perf * (1 + world.driftPpm * 1e-6) + world.serverAhead;
/** This phone's performance.now() at a server time. */
const perfAtServer = (serverMs: number) => (serverMs - world.serverAhead) / (1 + world.driftPpm * 1e-6);

const songBody: SongInput = {
  title: "Song", artist: "Band", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, content: "",
  bpm: 96, beatsPerBar: 3,
};

/** Which endpoint a request is for, by method and path; undefined for anything the world doesn't serve. */
function endpointOf(method: string, path: string): Endpoint | undefined {
  if (path === "/api/time" && method === "GET") return "getTime";
  if (path.startsWith("/api/metronome/")) return method === "PUT" ? "putMetronome" : method === "GET" ? "getMetronome" : undefined;
  return undefined;
}

const abortError = () => new DOMException("This operation was aborted", "AbortError");
/** What fetch rejects with when there is no network. */
const offlineError = () => new TypeError("Failed to fetch");

/**
 * The fake network, in place of fetch: up-leg, the real handler at the server's "now", down-leg. Fails at once
 * while offline (as fetch does with no network), never settles while hung, and rejects when aborted.
 */
function makeFetch(handlers: Record<Endpoint, (req: Request) => Promise<Response>>) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(new URL(input instanceof Request ? input.url : String(input), "http://localhost"), init);
    const name = endpointOf(req.method, new URL(req.url).pathname);
    if (!name) {
      world.unrouted.push(`${req.method} ${req.url}`);
      return Promise.reject(new TypeError(`the test world doesn't serve ${req.method} ${req.url}`));
    }
    world.sent[name]++;
    const l = world.latency[name];
    const [up, down] = typeof l === "function" ? l() : (l ?? [0, 0]);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      if (world.offline) return reject(offlineError());
      const timers: ReturnType<typeof setTimeout>[] = [];
      signal?.addEventListener(
        "abort",
        () => {
          timers.forEach(clearTimeout);
          reject(abortError());
        },
        { once: true },
      );
      if (world.hang) return; // never settles (unless aborted)
      timers.push(
        setTimeout(async () => {
          if (world.offline) return reject(offlineError());
          world.served[name].push(serverNow());
          const res = await handlers[name](req);
          if (signal?.aborted) return; // aborted while the server worked: it keeps the change, the phone never hears
          timers.push(setTimeout(() => resolve(res), down));
        }, up),
      );
    });
  };
}

export type Repo = ReturnType<typeof makeRepo>;

/** A recorded AudioBufferSourceNode playing a looped bar. */
export interface FakeLoop {
  /** The clicks in the looped bar, read from the rendered samples: seconds into the bar, and accent. */
  clicks: { at: number; accent: boolean }[];
  barS: number;
  when: number;
  offset: number;
  /** Audio time it really stops (never earlier than the moment stop() was called). */
  stoppedAt?: number;
}

interface FakeBuffer {
  length: number;
  getChannelData(ch: number): Float32Array;
}

/** Click onsets in a rendered bar: a sound after at least 2 ms of silence. Accent = the louder click. */
function clicksIn(buffer: FakeBuffer, sampleRate: number) {
  const x = buffer.getChannelData(0);
  const gap = Math.round(sampleRate * 0.002);
  const out: { at: number; accent: boolean }[] = [];
  let quiet = gap;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === 0) {
      quiet++;
      continue;
    }
    if (quiet >= gap) {
      let peak = 0;
      for (let j = i; j < Math.min(x.length, i + Math.round(sampleRate * 0.005)); j++) peak = Math.max(peak, Math.abs(x[j]));
      // The sample before a click's first non-zero one is its true onset (sin 0 = 0).
      out.push({ at: (i - 1) / sampleRate, accent: peak > 0.8 });
    }
    quiet = 0;
  }
  return out;
}

/** The phone's audio engine. currentTime follows world.perf (plus a rate error and a skew), unless frozen. */
export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Set before the context is made: getOutputTimestamp() is offered, with this jitter (ms) on performanceTime. */
  static outputTimestampJitter: (() => number) | null = null;
  state: "running" | "suspended" | "interrupted" | "closed" = "running";
  sampleRate = 48000;
  destination = {};
  loops: FakeLoop[] = [];
  /** perf ms at which currentTime was 0. */
  private bornPerf = world.perf;
  /** Audio clock speed error, e.g. 1e-4 = runs 100 ppm fast against performance.now(). */
  rate = 0;
  /** Seconds added to currentTime. */
  skewS = 0;
  /** While set, the audio clock is stopped at this value (suspended / interrupted). */
  frozenAt: number | null = null;
  /** resume() rejects, like iOS after a phone call without a fresh tap. */
  resumeBlocked = false;
  getOutputTimestamp?: () => { contextTime: number; performanceTime: number };

  constructor() {
    FakeAudioContext.instances.push(this);
    const jitter = FakeAudioContext.outputTimestampJitter;
    if (jitter) {
      this.getOutputTimestamp = () => ({ contextTime: this.currentTime, performanceTime: world.perf + jitter() });
    }
  }
  get currentTime() {
    if (this.frozenAt !== null) return this.frozenAt;
    return Math.max(0, ((world.perf - this.bornPerf) / 1000) * (1 + this.rate)) + this.skewS;
  }
  /** The audio time at which a server-time moment really happens on this phone (no nudge). */
  audioAt(serverMs: number) {
    return ((perfAtServer(serverMs) - this.bornPerf) / 1000) * (1 + this.rate) + this.skewS;
  }
  /** The server time at which an audio time on this phone really happens (inverse of audioAt). */
  serverAtAudio(audioS: number) {
    const perf = ((audioS - this.skewS) / (1 + this.rate)) * 1000 + this.bornPerf;
    return perf * (1 + world.driftPpm * 1e-6) + world.serverAhead;
  }
  freeze(state: "suspended" | "interrupted") {
    this.frozenAt = this.currentTime;
    this.state = state;
  }
  resume = vi.fn(async () => {
    if (this.resumeBlocked) throw new DOMException("not allowed without a user gesture", "NotAllowedError");
    if (this.frozenAt !== null) {
      // Pick up where it stopped.
      this.skewS += this.frozenAt - this.currentTimeUnfrozen();
      this.frozenAt = null;
    }
    this.state = "running";
  });
  private currentTimeUnfrozen() {
    return Math.max(0, ((world.perf - this.bornPerf) / 1000) * (1 + this.rate)) + this.skewS;
  }
  suspend = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createBuffer(_channels: number, length: number): FakeBuffer {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const ctx = this;
    const node = {
      buffer: null as unknown,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      connect: (n: unknown) => n,
      rec: undefined as FakeLoop | undefined,
      start(when: number, offset = 0) {
        node.rec = { clicks: clicksIn(node.buffer as FakeBuffer, ctx.sampleRate), barS: node.loopEnd, when, offset };
        ctx.loops.push(node.rec);
      },
      stop(at = 0) {
        if (!node.rec) return;
        node.rec.stoppedAt = Math.max(at, ctx.currentTime);
      },
    };
    return node;
  }
  createOscillator() {
    return { frequency: { value: 0 }, connect: (n: unknown) => n, start: () => {}, stop: () => {} };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: (n: unknown) => n,
      disconnect: () => {},
    };
  }
}

/** A click a listener would hear (audio s). `cut` = stopped before the click finished. */
export interface Heard {
  t: number;
  accent: boolean;
  cut: boolean;
  loop: number;
}

/** Every click onset the recorded loops actually play in [from, to) (audio s), sorted. */
export function heard(ctx: FakeAudioContext, from: number, to: number): Heard[] {
  const out: Heard[] = [];
  ctx.loops.forEach((l, i) => {
    const origin = l.when - l.offset;
    const end = Math.min(to, l.stoppedAt ?? Infinity);
    if (end <= l.when) return; // stopped before it started: never plays
    const lo = Math.max(from, l.when);
    for (let bar = Math.floor((lo - origin) / l.barS) - 1; origin + bar * l.barS < end; bar++) {
      for (const c of l.clicks) {
        const t = origin + bar * l.barS + c.at;
        if (t < lo - 1e-9 || t >= end - 1e-9) continue;
        out.push({ t, accent: c.accent, cut: (l.stoppedAt ?? Infinity) - t < CLICK_S - 1e-9, loop: i });
      }
    }
  });
  return out.sort((a, b) => a.t - b.t);
}

/** Loops still sounding at audio time t. */
export const soundingAt = (ctx: FakeAudioContext, t: number) =>
  ctx.loops.filter((l) => l.when <= t && (l.stoppedAt === undefined || l.stoppedAt > t));

/** Moves the virtual clock forward, in small steps so timers, network and audio stay in step. */
export async function advance(ms: number, step = 5) {
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    world.perf += d;
    left -= d;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(d);
    });
  }
}

/** Advances until `cond()` holds (or `maxMs` passes). Returns the time it took. */
export async function advanceUntil(cond: () => boolean, maxMs = 30_000, step = 1) {
  let spent = 0;
  while (!cond() && spent < maxMs) {
    await advance(step, step);
    spent += step;
  }
  if (!cond()) throw new Error("advanceUntil: condition never held");
  return spent;
}

/** The api calls a test file mocked (the song calls); the rest are real functions, left alone. */
const songMocks = () =>
  Object.values(api).filter((f): f is ReturnType<typeof vi.fn> => vi.isMockFunction(f));
const songMock = (name: keyof typeof api) => (vi.isMockFunction(api[name]) ? api[name] : undefined);

/** Resets the world and wires the api mocks to a fresh server. Call from beforeEach. */
export async function setupWorld(opts: { perf?: number } = {}) {
  world.perf = opts.perf ?? 10_000;
  world.serverAhead = SERVER_AT_PERF_0;
  world.driftPpm = 0;
  world.latency = {};
  world.offline = false;
  world.hang = false;
  world.unrouted = [];
  world.served = { getTime: [], getMetronome: [], putMetronome: [] };
  world.sent = { getTime: 0, getMetronome: 0, putMetronome: 0 };
  FakeAudioContext.instances = [];
  FakeAudioContext.outputTimestampJitter = null;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  localStorage.clear();

  const repo = makeRepo(memoryKV());
  const song: Song = await repo.createSong(songBody);

  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  vi.setSystemTime(serverNow()); // this phone's wall clock happens to be right
  vi.spyOn(performance, "now").mockImplementation(() => world.perf);

  const metronome = makeMetronomeHandler(repo, serverNow);
  vi.stubGlobal(
    "fetch",
    makeFetch({ getTime: makeTimeHandler(serverNow), getMetronome: metronome, putMetronome: metronome }),
  );

  songMocks().forEach((f) => f.mockReset());
  songMock("updateSong")?.mockImplementation(async (id: string, patch: Partial<SongInput>, baseVersion?: string) =>
    repo.updateSong(id, { ...patch, ...(baseVersion ? { baseVersion } : {}) }),
  );
  songMock("getSong")?.mockImplementation(async (id: string) => {
    const s = await repo.getSong(id);
    if (!s) throw new ApiError(404, "song not found");
    return s;
  });

  /** Another phone acting on the server right now (no network delay on its side). */
  const other = (change: MetroChange) => repo.setMetronome(song.id, change, serverNow());
  const stored = () => repo.getMetronome(song.id, serverNow());
  return { repo, song, other, stored };
}

export function teardownWorld() {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  if (world.unrouted.length) throw new Error(`the test world was sent requests it doesn't serve: ${world.unrouted.join(", ")}`);
}

export function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Seeded PRNG (mulberry32), so random latency and jitter repeat run to run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
