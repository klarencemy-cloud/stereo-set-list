import { describe, expect, it } from "vitest";
import { approach, createSmoother } from "../../src/app/tuner/smooth";

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const shift = (f: number, c: number) => f * Math.pow(2, c / 1200);

/** A repeatable random number generator: the same noise every run. */
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Feeds readings 50 ms apart from `t0` and returns every output with its time. */
function feed(s: ReturnType<typeof createSmoother>, readings: (number | null)[], t0 = 0) {
  return readings.map((f, i) => ({ t: t0 + i * 50, out: s.push(f, t0 + i * 50) }));
}

describe("createSmoother", () => {
  it("settles noisy readings (±1 cent jitter) to a steady value", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = seeded(seed);
      const s = createSmoother();
      const out = feed(s, Array.from({ length: 200 }, () => shift(110, rand() * 2 - 1)));
      // After half a second it has settled: typical wobble well under 0.3 cents, nothing near a whole cent.
      const settled = out.filter((o) => o.t >= 500).map((o) => cents(o.out!, 110));
      const mean = settled.reduce((a, b) => a + b, 0) / settled.length;
      const rms = Math.sqrt(settled.reduce((a, b) => a + b * b, 0) / settled.length);
      // The mean follows the noise itself (about ±0.04 cents for 200 readings), not the smoother.
      expect(Math.abs(mean)).toBeLessThan(0.2);
      expect(rms).toBeLessThan(0.3);
      for (const c of settled) expect(Math.abs(c)).toBeLessThan(1);
    }
  });

  it("is much steadier than the raw readings", () => {
    const rand = seeded(7);
    const raw = Array.from({ length: 200 }, () => shift(110, rand() * 2 - 1));
    const out = feed(createSmoother(), raw).filter((o) => o.t >= 500);
    const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
    const rawRms = rms(raw.slice(10).map((f) => cents(f, 110)));
    expect(rms(out.map((o) => cents(o.out!, 110)))).toBeLessThan(rawRms / 2);
  });

  it("skips the first 2 readings of a note: a plucked string starts sharp", () => {
    const s = createSmoother();
    expect(s.push(shift(110, 30), 0)).toBeNull();
    expect(s.push(shift(110, 15), 50)).toBeNull();
    expect(s.push(110, 100)).toBeCloseTo(110, 6);
  });

  it("skips the first 2 readings again after silence", () => {
    const s = createSmoother();
    feed(s, [110, 110, 110, 110]);
    expect(s.push(null, 200)).toBeNull();
    expect(s.push(shift(110, 30), 250)).toBeNull();
    expect(s.push(shift(110, 20), 300)).toBeNull();
    const after = s.push(110, 350)!;
    expect(Math.abs(cents(after, 110))).toBeLessThan(0.01);
  });

  it("ignores a single reading far away (an octave error)", () => {
    const s = createSmoother();
    const out = feed(s, [110, 110, 110, 110, 110, 220, 110, 110]);
    for (const o of out.slice(2)) expect(Math.abs(cents(o.out!, 110))).toBeLessThan(0.01);
  });

  it("ignores two odd readings in a row too", () => {
    const s = createSmoother();
    const out = feed(s, [110, 110, 110, 110, 220, 220, 110, 110]);
    for (const o of out.slice(2)) expect(Math.abs(cents(o.out!, 110))).toBeLessThan(0.01);
  });

  it("switches to a new note after 3 readings in a row, starting fresh", () => {
    const s = createSmoother();
    const out = feed(s, [110, 110, 110, 110, 146.83, 146.83, 146.83, 146.83]);
    expect(Math.abs(cents(out[5].out!, 110))).toBeLessThan(0.01); // 2nd reading at the new note: still held
    expect(out[6].out).toBeCloseTo(146.83, 6); // 3rd: switched, no slow slide from A
    expect(out[7].out).toBeCloseTo(146.83, 6);
  });

  it("follows a small change smoothly instead of jumping", () => {
    const s = createSmoother();
    feed(s, Array(10).fill(110));
    const target = shift(110, 20);
    const out = feed(s, Array(30).fill(target), 500);
    const c = out.map((o) => cents(o.out!, 110));
    expect(c[0]).toBeGreaterThan(0);
    expect(c[0]).toBeLessThan(10); // part of the way, not all at once
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    const settledAt = out.find((o) => Math.abs(cents(o.out!, target)) < 0.5)!.t - 500;
    expect(settledAt).toBeLessThanOrEqual(600);
  });

  it("smooths the same amount whatever the reading rate", () => {
    const fast = createSmoother();
    const slow = createSmoother();
    feed(fast, Array(5).fill(110));
    feed(slow, Array(5).fill(110));
    const target = shift(110, 20);
    let f = 0;
    for (let t = 250; t <= 550; t += 25) f = fast.push(target, t)!;
    let sl = 0;
    for (let t = 250; t <= 550; t += 100) sl = slow.push(target, t)!;
    expect(Math.abs(cents(f, sl))).toBeLessThan(1);
  });

  it("reset starts over, skipping the attack again", () => {
    const s = createSmoother();
    feed(s, [110, 110, 110]);
    s.reset();
    expect(s.push(220, 200)).toBeNull();
    expect(s.push(220, 250)).toBeNull();
    expect(s.push(220, 300)).toBeCloseTo(220, 6);
  });
});

describe("approach", () => {
  it("moves part of the way and converges without overshooting", () => {
    let x = 0;
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      x = approach(x, 10, 16, 80);
      seen.push(x);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i]).toBeLessThanOrEqual(10);
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(10);
    expect(seen.at(-1)).toBeCloseTo(10, 3);
    // Downwards too, and a huge step lands on the target, never past it.
    expect(approach(10, -5, 16, 80)).toBeGreaterThan(-5);
    expect(approach(10, -5, 100000, 80)).toBe(-5);
    expect(approach(3, 3, 16, 80)).toBe(3);
    expect(approach(0, 10, 0, 80)).toBe(0);
  });
});
