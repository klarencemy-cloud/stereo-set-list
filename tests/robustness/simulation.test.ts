// Protocol simulation of N phones (Phase 2). Pure: it runs the real clock maths and constants, not React.
//
// Each phone has its own performance.now() (any origin, ±100 ppm against the server) and its own audio clock
// (±100 ppm against true time), and reads the link between them with an optional jitter. It syncs as useClockSync
// does with shared answers off: a first round of FIRST_ROUND time calls when the panel opens, then one sample per
// session check (every POLL_JOINED_MS, each answer carries the server's time; a check slower than
// METRONOME_TIMEOUT_MS gives no answer), grouped into ROUND_EVERY_MS rounds, best of the last ROUNDS_KEPT via the
// real estimateOffset. It ticks every TICK_MS like useSyncedMetronome.reconcile: the real linkSmoother, the real
// phaseError and shouldRealign (median over REALIGN_TICKS ticks above REALIGN_S), and a re-align placed from the
// newest REALIGN_TICKS link readings that switches at the next bar line, an early loop at its own bar line (H9).
// "Error" is where a phone's bar line really sounds against the server's grid, ignoring output latency (i.e. as
// if every phone were calibrated perfectly). Phones here sync by the clock alone: none is matched by ear.
//
// The second part asks whether a change reaches every joined phone before its startAt, given the real check
// interval, timeout and lead, and what another lead or check interval would change (data only).
//
// Ticking every 25 ms is slow, so `npm test` runs a short error table (2 trials of 15 minutes). The review's
// tables are the full run: SIM=1 npx vitest run tests/robustness/simulation.test.ts (PowerShell: $env:SIM=1 first).
import { describe, it, expect } from "vitest";
import { METRONOME_TIMEOUT_MS, TIME_TIMEOUT_MS } from "../../src/app/api";
import { estimateOffset, LINK_WINDOW_MS, linkSmoother, toAudioTime, type ClockEstimate, type TimeSample } from "../../src/app/metronome/clock";
import { phaseError, REALIGN_S, REALIGN_TICKS, shouldRealign } from "../../src/app/metronome/loop";
import { POLL_JOINED_MS, START_MARGIN_S, TICK_MS } from "../../src/app/metronome/useSyncedMetronome";
import { FIRST_ROUND, LATER_ROUND, ROUND_EVERY_MS, ROUNDS_KEPT } from "../../src/app/metronome/useClockSync";
import { applyChange, beatsInWindow, LEAD_MS, type MetroSession } from "../../src/shared/metronome";
import { rng } from "./harness";

/** The full run, for the review's tables. */
const FULL = !!process.env.SIM;

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
  /** performance.now() runs (1 + perfDrift) times true speed; the audio clock (1 + audioDrift) times. */
  perfDrift: number;
  audioDrift: number;
  P0: number;
  A0: number;
  /** useClockSync's rounds, and when the latest began (local ms). */
  rounds: TimeSample[][] = [];
  roundStartMs = 0;
  estimate: ClockEstimate | null = null;
  /** Checks sent but not answered yet: the sample, and the true time its answer lands. */
  inFlight: { sample: TimeSample; at: number }[] = [];
  nextCheckAt = 0;
  smoother = linkSmoother();
  /** The loop sounding: its bar-0 origin (audio s). */
  origin: number | null = null;
  /** The loop a re-align booked: the old one sounds until `when`, then this one takes over and is checked. */
  next: { origin: number; when: number } | null = null;
  errors: number[] = [];
  realigns = 0;
  constructor(r: Rand, t0: number, perfPpm: number, audioPpm: number, private jitterS: number) {
    this.perfDrift = (r() * 2 - 1) * perfPpm * 1e-6;
    this.audioDrift = (r() * 2 - 1) * audioPpm * 1e-6;
    this.P0 = t0 - r() * 3_600_000; // the page opened up to an hour ago
    this.A0 = t0 - r() * 600_000;
  }
  perf = (t: number) => (t - this.P0) * (1 + this.perfDrift);
  audio = (t: number) => ((t - this.A0) * (1 + this.audioDrift)) / 1000;
  trueOfAudio = (a: number) => this.A0 + (a * 1000) / (1 + this.audioDrift);
  /** One call from true time t: its sample, when its answer lands, and whether it beat `timeoutMs`. */
  call(t: number, leg: Leg, r: Rand, timeoutMs: number) {
    const [up, down] = leg(r);
    const sample = { sentMs: this.perf(t), serverMs: t + up, receivedMs: this.perf(t + up + down) };
    return up + down <= timeoutMs ? { sample, at: t + up + down, ok: true } : { sample, at: t + timeoutMs, ok: false };
  }
  /** The first round: FIRST_ROUND serial /api/time calls when the panel opens. Returns when it ends. */
  firstRound(t: number, leg: Leg, r: Rand) {
    const out: TimeSample[] = [];
    for (let i = 0; i < FIRST_ROUND; i++) {
      const c = this.call(t, leg, r, TIME_TIMEOUT_MS);
      if (c.ok) out.push(c.sample);
      t = c.at;
    }
    this.newRound(out);
    return t;
  }
  newRound(samples: TimeSample[]) {
    this.rounds = [...this.rounds, samples].slice(-ROUNDS_KEPT);
    this.roundStartMs = Math.min(...samples.map((s) => s.sentMs));
  }
  /** useClockSync's sink: one more sample, from a session check's answer. */
  addSample(s: TimeSample) {
    if (s.sentMs - this.roundStartMs >= ROUND_EVERY_MS) this.newRound([s]);
    else this.rounds[this.rounds.length - 1].push(s);
    this.estimate = estimateOffset(this.rounds.flat());
  }
  /** A link reading as getOutputTimestamp() gives it, jittered by up to ±jitterS on the audio side. */
  reading(t: number, r: Rand) {
    return { perfMs: this.perf(t), audioS: this.audio(t) + (r() * 2 - 1) * this.jitterS };
  }
  /** The loop sounding at audio time a. */
  soundingOrigin(a: number) {
    if (this.next && a >= this.next.when) {
      this.origin = this.next.origin;
      this.next = null;
      this.errors = [];
    }
    return this.origin!;
  }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Inter-phone bar-line error over a session (true ms), for one network profile. */
function runError(
  legs: Leg | Leg[],
  opts: { phones?: number; trials?: number; minutes?: number; perfPpm?: number; audioPpm?: number; jitterMs?: number; seed?: number } = {},
) {
  const { phones = 5, trials = FULL ? 6 : 2, minutes = FULL ? 30 : 15, perfPpm = 100, audioPpm = 100, jitterMs = 0, seed = 1 } = opts;
  const legOf = (i: number) => (Array.isArray(legs) ? legs[i % legs.length] : legs);
  const r = rng(seed);
  const pair: number[] = [];
  const abs: number[] = [];
  let realigns = 0;
  const measureEvery = Math.round(1000 / TICK_MS);
  for (let trial = 0; trial < trials; trial++) {
    const t0 = Date.UTC(2026, 10, 15, 18) + trial * 7_200_000;
    const s: MetroSession = applyChange(null, { bpm: 120, beatsPerBar: 4, running: true }, t0);
    const barMs = (s.beatsPerBar * 60000) / s.bpm;
    const barS = barMs / 1000;
    const ps = Array.from({ length: phones }, () => new Phone(r, t0, perfPpm, audioPpm, jitterMs / 1000));
    // The panel opened a little before the start, and its first round landed before it (H1's fix).
    ps.forEach((p, i) => {
      const opened = t0 - 30_000 + r() * 1000;
      p.firstRound(opened, legOf(i), r);
      p.estimate = estimateOffset(p.rounds.flat());
      p.nextCheckAt = opened + r() * POLL_JOINED_MS;
    });
    let tick = 0;
    for (let t = s.startAt; t < s.startAt + minutes * 60_000; t += TICK_MS, tick++) {
      const measure = tick % measureEvery === 0 && t >= s.startAt + 1000;
      const errs: number[] = [];
      for (const [i, p] of ps.entries()) {
        // Session checks: one goes out every POLL_JOINED_MS, answered or not; each answer is a clock sample.
        while (t >= p.nextCheckAt) {
          const c = p.call(p.nextCheckAt, legOf(i), r, METRONOME_TIMEOUT_MS);
          if (c.ok) p.inFlight.push(c);
          p.nextCheckAt += POLL_JOINED_MS;
        }
        if (p.inFlight.some((c) => c.at <= t)) {
          for (const c of p.inFlight.filter((c) => c.at <= t).sort((a, b) => a.at - b.at)) p.addSample(c.sample);
          p.inFlight = p.inFlight.filter((c) => c.at > t);
        }
        // reconcile(): where this phone believes the grid's bar 0 is on its audio clock, now.
        const a = p.audio(t);
        const offsetMs = p.estimate!.offsetMs;
        const startS = toAudioTime(s.startAt, offsetMs, p.smoother.add(p.reading(t, r)), 0);
        if (p.origin === null) p.origin = startS;
        const origin = p.soundingOrigin(a);
        if (!p.next) {
          p.errors = [...p.errors, phaseError(startS, origin, barS)].slice(-REALIGN_TICKS);
          if (shouldRealign(p.errors)) {
            const gridS = toAudioTime(s.startAt, offsetMs, p.smoother.keepNewest(REALIGN_TICKS), 0);
            const earlyS = Math.min(0, phaseError(gridS, origin, barS));
            const at = gridS + Math.ceil((a + 0.1 - earlyS - gridS) / barS) * barS;
            // The old loop plays on to at + earlyS (its own bar line when early); the new one starts at `at`.
            p.next = { origin: at, when: at };
            p.realigns++;
          }
        }
        if (!measure) continue;
        // The loop's bar line nearest now, in true time, against the server's grid.
        const line = origin + Math.round((a - origin) / barS) * barS;
        let dd = (p.trueOfAudio(line) - s.startAt) % barMs;
        if (dd > barMs / 2) dd -= barMs;
        if (dd < -barMs / 2) dd += barMs;
        errs.push(dd);
      }
      for (let i = 0; i < errs.length; i++) {
        abs.push(Math.abs(errs[i]));
        for (let j = i + 1; j < errs.length; j++) pair.push(Math.abs(errs[i] - errs[j]));
      }
    }
    realigns += ps.reduce((n, p) => n + p.realigns, 0);
    // Keep the grid sanity-checked against the real beat maths.
    expect(beatsInWindow(s, s.startAt, s.startAt + barMs)).toHaveLength(4);
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
 * Share of changes that reach every one of N joined phones in time to play their first beat, for the check chain
 * in useSyncedMetronome: a check goes out every `poll` ms whether or not the last one answered, a check slower than
 * METRONOME_TIMEOUT_MS gives no answer, and the first answer read after the change is the one that counts (an
 * older one landing later is dropped).
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
      // This phone's checks, from a random phase; stop once a later check can't land before the earliest answer.
      let sent = c - 10_000 - r() * poll;
      let arrival = Infinity;
      while (sent < c + 10_000 && sent < arrival) {
        const [up, down] = leg(r);
        if (up + down <= METRONOME_TIMEOUT_MS && sent + up > c) arrival = Math.min(arrival, sent + up + down);
        sent += poll;
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
  it(`inter-phone bar-line error, 5 phones, ${FULL ? "6 × 30" : "2 × 15"} min, 120 BPM 4/4, ±100 ppm on both clocks (logged)`, () => {
    const rows = PROFILES.map(({ name, leg }) => ({ name, ...runError(leg) }));
    const wifi = profile(20, 80, 0.5);
    const extra = [
      { name: "Wi-Fi, no drift at all", ...runError(wifi, { perfPpm: 0, audioPpm: 0 }) },
      { name: "Wi-Fi, perf ±100, audio 0", ...runError(wifi, { audioPpm: 0 }) },
      { name: "Wi-Fi, perf 0, audio ±100", ...runError(wifi, { perfPpm: 0 }) },
      { name: "Wi-Fi, ±20 ppm both", ...runError(wifi, { perfPpm: 20, audioPpm: 20 }) },
      { name: "mixed: Wi-Fi + lopsided 4G", ...runError([wifi, PROFILES[4].leg]) },
      { name: "Wi-Fi, link jitter ±5 ms", ...runError(wifi, { jitterMs: 5 }) },
      { name: "Wi-Fi, link jitter ±15 ms", ...runError(wifi, { jitterMs: 15 }) },
      { name: "Wi-Fi, link jitter ±30 ms", ...runError(wifi, { jitterMs: 30 }) },
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
    // H8: jitter the median absorbs never re-aligns on every bar (120 BPM 4/4 has 1800 bars an hour).
    expect(extra.find((x) => x.name.endsWith("±15 ms"))!.realignsPerHour).toBeLessThan(60);
  }, FULL ? 600_000 : 60_000);

  it("share of changes heard by all 5 phones before startAt; and with another lead or check interval (logged)", () => {
    const lines: string[] = [];
    const header = `  profile                     kind   | lead ${LEAD_MS / 1000} s/check ${POLL_JOINED_MS / 1000} s (now) | lead 2 s | lead 4 s | check 1.5 s | check 1 s`;
    for (const { name, leg } of PROFILES) {
      for (const kind of ["start", "tempo"] as const) {
        const now = runReach(leg, { kind });
        const cells = [
          runReach(leg, { kind, lead: 2000 }),
          runReach(leg, { kind, lead: 4000 }),
          runReach(leg, { kind, poll: 1500 }),
          runReach(leg, { kind, poll: 1000 }),
        ];
        lines.push(`  ${name.padEnd(26)}  ${kind.padEnd(5)}  | ${share(now.allPhones)} (1 phone misses ${share(now.perPhoneMiss).trim()}) | ${cells.map((c) => share(c.allPhones)).join(" | ")}`);
      }
    }
    console.log(`[SIM] changes that reach ALL 5 joined phones in time for beat 1\n${header}\n${lines.join("\n")}`);
    expect(runReach(PROFILES[0].leg, { kind: "start" }).allPhones).toBe(1);
    expect(runReach(PROFILES[1].leg, { kind: "start" }).allPhones).toBe(1);
  }, 120_000);

  it("requests per joined phone per hour, from the real constants (for H19)", () => {
    const polls = 3_600_000 / POLL_JOINED_MS;
    // Shared answers off: only the first round makes time calls; after it, the session checks' answers are the
    // samples. Shared answers on (#25): add LATER_ROUND time calls every ROUND_EVERY_MS.
    const off = FIRST_ROUND;
    const on = FIRST_ROUND + (LATER_ROUND * 3_600_000) / ROUND_EVERY_MS;
    console.log(
      `[SIM] per joined phone per hour: ${polls} session checks + ~${off} /api/time = ~${polls + off} function calls` +
        ` (shared answers on: ~${on} /api/time, and the checks served from the cache don't run the function)`,
    );
    expect(polls).toBe(1800); // a 2 s check: 25 % fewer than the 1.5 s one (2400)
  });

  it("the app's constants are still the ones the review's tables were run with", () => {
    // The simulation imports the app's constants. When one changes, re-run the tables in the robustness review.
    const used = {
      REALIGN_S, REALIGN_TICKS, TICK_MS, START_MARGIN_S, LINK_WINDOW_MS, POLL_JOINED_MS, LEAD_MS,
      FIRST_ROUND, LATER_ROUND, ROUND_EVERY_MS, ROUNDS_KEPT, METRONOME_TIMEOUT_MS, TIME_TIMEOUT_MS,
    };
    expect(used).toEqual({
      REALIGN_S: 0.012, REALIGN_TICKS: 8, TICK_MS: 25, START_MARGIN_S: 0.05, LINK_WINDOW_MS: 1500, POLL_JOINED_MS: 2000,
      LEAD_MS: 3000, FIRST_ROUND: 20, LATER_ROUND: 3, ROUND_EVERY_MS: 60_000, ROUNDS_KEPT: 3, METRONOME_TIMEOUT_MS: 2500,
      TIME_TIMEOUT_MS: 2000,
    });
  });
});
