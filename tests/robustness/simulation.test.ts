// Protocol simulation of N phones (Phase 2). Pure: it runs the real clock maths and constants, not React.
//
// Each phone has its own performance.now() (any origin, ±100 ppm against the server) and its own audio clock
// (±100 ppm against true time). It syncs like useClockSync (20 samples, then 3 every ROUND_EVERY_MS, best of the
// last 3 rounds, via the real estimateOffset), books the session's bar with the real toAudioTime, and re-aligns
// the way useSyncedMetronome.reconcile did before H8 was fixed (real phaseError; one link reading per tick, re-aligned
// on any single tick over 10 ms), so its re-align counts are for that older rule. "Error" is where a phone's bar line really
// sounds against the server's grid, ignoring output latency (i.e. as if every phone were calibrated perfectly).
//
// The second part asks whether a change reaches every joined phone before its startAt, given the real poll
// interval and lead, and what a longer lead or faster poll would change (data only).
import { describe, it, expect } from "vitest";
import { estimateOffset, toAudioTime, type ClockLink, type TimeSample } from "../../src/app/metronome/clock";
import { phaseError } from "../../src/app/metronome/loop";
import { POLL_JOINED_MS } from "../../src/app/metronome/useSyncedMetronome";
import { ROUND_EVERY_MS } from "../../src/app/metronome/useClockSync";
import { applyChange, beatsInWindow, LEAD_MS, type MetroSession } from "../../src/shared/metronome";
import { rng } from "./harness";

// Mirrors of private constants (not exported from the app code).
const FIRST_ROUND = 20; // useClockSync.ts
const LATER_ROUND = 3; // useClockSync.ts
const ROUNDS_KEPT = 3; // useClockSync.ts
const REALIGN_S = 0.01; // useSyncedMetronome.ts before the H8 fix
const START_MARGIN_S = 0.05; // useSyncedMetronome.ts
const TICK_MS = 25; // useSyncedMetronome.ts

type Rand = () => number;
type Leg = (r: Rand) => [up: number, down: number];

/** RTT between lo and hi (skewed towards lo, with spikes), the up leg taking `upShare` of it (±5 %). */
const profile = (lo: number, hi: number, upShare: number): Leg => (r) => {
  const total = lo + (hi - lo) * r() ** 2;
  const share = upShare + (r() - 0.5) * 0.1;
  return [total * share, total * (1 - share)];
};

const PROFILES: { name: string; leg: Leg }[] = [
  { name: "Wi-Fi 20-80 ms", leg: profile(20, 80, 0.5) },
  { name: "4G 80-400 ms", leg: profile(80, 400, 0.5) },
  { name: "congested 300-1500 ms", leg: profile(300, 1500, 0.5) },
  { name: "lopsided Wi-Fi (up 25 %)", leg: profile(20, 80, 0.25) },
  { name: "lopsided 4G (up 20 %)", leg: profile(80, 400, 0.2) },
];

class Phone {
  /** perf runs (1 + d) times true speed; audio (1 + e) times. */
  d: number;
  e: number;
  P0: number;
  A0: number;
  rounds: TimeSample[][] = [];
  origin: number | null = null;
  realigns = 0;
  nextRoundAt = 0;
  constructor(r: Rand, t0: number, perfPpm: number, audioPpm: number) {
    this.d = (r() * 2 - 1) * perfPpm * 1e-6;
    this.e = (r() * 2 - 1) * audioPpm * 1e-6;
    this.P0 = t0 - r() * 3_600_000; // the page opened up to an hour ago
    this.A0 = t0 - r() * 600_000;
  }
  perf = (t: number) => (t - this.P0) * (1 + this.d);
  audio = (t: number) => ((t - this.A0) * (1 + this.e)) / 1000;
  trueOfAudio = (a: number) => this.A0 + (a * 1000) / (1 + this.e);
  link = (t: number): ClockLink => ({ perfMs: this.perf(t), audioS: this.audio(t) });
  /** One round of serial /api/time calls from true time t. Returns when it ends. */
  sample(n: number, t: number, leg: Leg, r: Rand) {
    const out: TimeSample[] = [];
    for (let i = 0; i < n; i++) {
      const [up, down] = leg(r);
      out.push({ sentMs: this.perf(t), serverMs: t + up, receivedMs: this.perf(t + up + down) });
      t += up + down;
    }
    this.rounds = [...this.rounds, out].slice(-ROUNDS_KEPT);
    return t;
  }
  est = () => estimateOffset(this.rounds.flat())!;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Inter-phone bar-line error over a session (true ms), for one network profile. */
function runError(
  legs: Leg | Leg[],
  opts: { phones?: number; trials?: number; minutes?: number; perfPpm?: number; audioPpm?: number; seed?: number } = {},
) {
  const { phones = 5, trials = 12, minutes = 30, perfPpm = 100, audioPpm = 100, seed = 1 } = opts;
  const legOf = (i: number) => (Array.isArray(legs) ? legs[i % legs.length] : legs);
  const r = rng(seed);
  const pair: number[] = [];
  const abs: number[] = [];
  let realigns = 0;
  for (let trial = 0; trial < trials; trial++) {
    const t0 = Date.UTC(2026, 10, 15, 18) + trial * 7_200_000;
    let s: MetroSession = applyChange(null, { bpm: 120, beatsPerBar: 4, running: true }, t0);
    const barMs = (s.beatsPerBar * 60000) / s.bpm;
    const barS = barMs / 1000;
    const ps = Array.from({ length: phones }, () => new Phone(r, t0, perfPpm, audioPpm));
    ps.forEach((p, i) => (p.nextRoundAt = p.sample(FIRST_ROUND, t0 + r() * 1000, legOf(i), r) + ROUND_EVERY_MS));
    for (let t = s.startAt + 1000; t < s.startAt + minutes * 60_000; t += 1000) {
      const errs: number[] = [];
      for (const [i, p] of ps.entries()) {
        if (t >= p.nextRoundAt) p.nextRoundAt = p.sample(LATER_ROUND, t, legOf(i), r) + ROUND_EVERY_MS;
        // reconcile(): where this phone believes the grid's bar 0 is on its audio clock, now.
        const belief = toAudioTime(s.startAt, p.est().offsetMs, p.link(t), 0);
        if (p.origin === null) p.origin = belief;
        else if (Math.abs(phaseError(belief, p.origin, barS)) > REALIGN_S) {
          p.origin = belief;
          p.realigns++;
        }
        // The loop's bar line nearest now, in true time, against the server's grid.
        const a = p.audio(t);
        const line = p.origin + Math.round((a - p.origin) / barS) * barS;
        const tt = p.trueOfAudio(line);
        let d = (tt - s.startAt) % barMs;
        if (d > barMs / 2) d -= barMs;
        if (d < -barMs / 2) d += barMs;
        errs.push(d);
      }
      for (let i = 0; i < errs.length; i++) {
        abs.push(Math.abs(errs[i]));
        for (let j = i + 1; j < errs.length; j++) pair.push(Math.abs(errs[i] - errs[j]));
      }
    }
    realigns += ps.reduce((n, p) => n + p.realigns, 0);
    // Keep the grid sanity-checked against the real beat maths.
    expect(beatsInWindow(s, s.startAt, s.startAt + barMs)).toHaveLength(4);
    s = { ...s };
  }
  pair.sort((a, b) => a - b);
  abs.sort((a, b) => a - b);
  const phoneHours = (phones * trials * minutes) / 60;
  return {
    p50: pct(pair, 50), p95: pct(pair, 95), max: pair[pair.length - 1],
    absP95: pct(abs, 95), realignsPerHour: realigns / phoneHours,
  };
}

/**
 * Share of changes that reach every one of N joined phones in time to play their first beat, for the poll
 * chain in useSyncedMetronome (next check timed from the last one's start, never overlapping).
 */
function runReach(leg: Leg, opts: { kind: "start" | "tempo"; lead?: number; poll?: number; phones?: number; trials?: number; seed?: number }) {
  const { kind, lead = LEAD_MS, poll = POLL_JOINED_MS, phones = 5, trials = 4000, seed = 2 } = opts;
  const r = rng(seed);
  let all = 0;
  let phoneMiss = 0;
  const t0 = Date.UTC(2026, 10, 15, 18);
  const running: MetroSession = applyChange(null, { bpm: 120, beatsPerBar: 4, running: true }, t0 - 60_000, lead);
  for (let trial = 0; trial < trials; trial++) {
    const c = t0 + r() * 2000; // when the change is read and stored at the server
    const next =
      kind === "start"
        ? applyChange(null, { bpm: 120, beatsPerBar: 4, running: true }, c, lead)
        : applyChange(running, { bpm: 100 }, c, lead);
    let ok = true;
    for (let i = 0; i < phones; i++) {
      // This phone's polls, from a random phase.
      let sent = c - 10_000 - r() * poll;
      let arrival = Infinity;
      while (sent < c + 10_000) {
        const [up, down] = leg(r);
        if (sent + up > c) {
          arrival = sent + up + down;
          break;
        }
        sent += Math.max(poll, up + down);
      }
      // reconcile() runs within a tick of the answer and needs START_MARGIN before the first beat.
      const inTime = arrival + TICK_MS + START_MARGIN_S * 1000 <= next.startAt;
      if (!inTime) phoneMiss++;
      ok &&= inTime;
    }
    if (ok) all++;
  }
  return { allPhones: all / trials, perPhoneMiss: phoneMiss / (trials * phones) };
}

const f = (n: number, d = 1) => n.toFixed(d).padStart(6);
const share = (x: number) => `${(x * 100).toFixed(1).padStart(5)} %`;

describe("Phase 2: protocol simulation", () => {
  it("inter-phone bar-line error, 5 phones, 30 min, 120 BPM 4/4, ±100 ppm on both clocks (logged)", () => {
    const rows = PROFILES.map(({ name, leg }) => {
      const e = runError(leg);
      return { name, ...e };
    });
    const wifi = profile(20, 80, 0.5);
    const extra = [
      { name: "Wi-Fi, no drift at all", ...runError(wifi, { perfPpm: 0, audioPpm: 0 }) },
      { name: "Wi-Fi, perf ±100, audio 0", ...runError(wifi, { audioPpm: 0 }) },
      { name: "Wi-Fi, perf 0, audio ±100", ...runError(wifi, { perfPpm: 0 }) },
      { name: "Wi-Fi, ±20 ppm both", ...runError(wifi, { perfPpm: 20, audioPpm: 20 }) },
      { name: "mixed: Wi-Fi + lopsided 4G", ...runError([wifi, PROFILES[4].leg]) },
    ];
    const line = (x: { name: string; p50: number; p95: number; max: number; absP95: number; realignsPerHour: number }) =>
      `  ${x.name.padEnd(26)}${f(x.p50)} ${f(x.p95)} ${f(x.max)}  |  ${f(x.absP95)}        ${f(x.realignsPerHour)}`;
    console.log(
      "[SIM] inter-phone error (|bar line A − bar line B|, ms), output latency assumed calibrated out\n" +
        "  profile                     p50    p95    max  |  one phone p95  re-aligns/phone-hour\n" +
        rows.map(line).join("\n") +
        "\n  -- decomposition and variants --\n" +
        extra.map(line).join("\n"),
    );
    expect(rows[0].p95).toBeLessThan(20); // T2 on Wi-Fi, from the protocol alone
  }, 60_000);

  it("share of changes heard by all 5 phones before startAt; and with a longer lead or faster poll (logged)", () => {
    const lines: string[] = [];
    const header = "  profile                     kind   | lead 2 s/poll 1.5 s (now) | lead 3 s | lead 4 s | poll 1 s | poll 0.75 s";
    for (const { name, leg } of PROFILES) {
      for (const kind of ["start", "tempo"] as const) {
        const now = runReach(leg, { kind });
        const cells = [
          now,
          runReach(leg, { kind, lead: 3000 }),
          runReach(leg, { kind, lead: 4000 }),
          runReach(leg, { kind, poll: 1000 }),
          runReach(leg, { kind, poll: 750 }),
        ];
        lines.push(`  ${name.padEnd(26)}  ${kind.padEnd(5)}  | ${share(cells[0].allPhones)} (1 phone misses ${share(now.perPhoneMiss).trim()}) | ${cells.slice(1).map((c) => share(c.allPhones)).join(" | ")}`);
      }
    }
    console.log(`[SIM] changes that reach ALL 5 joined phones in time for beat 1\n${header}\n${lines.join("\n")}`);
    const wifi = runReach(PROFILES[0].leg, { kind: "start" });
    expect(wifi.allPhones).toBe(1);
  }, 120_000);

  it("requests per joined phone per hour, from the real constants (for H19)", () => {
    const polls = 3_600_000 / POLL_JOINED_MS;
    const time = FIRST_ROUND + (LATER_ROUND * 3_600_000) / ROUND_EVERY_MS;
    console.log(`[SIM] per joined phone per hour: ${polls} session checks + ~${Math.round(time)} /api/time = ~${Math.round(polls + time)} function calls`);
    expect(polls).toBe(2400);
  });
});
