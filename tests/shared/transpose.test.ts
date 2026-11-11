import { describe, expect, it } from "vitest";
import {
  KEYS,
  isChord,
  isValidKey,
  prefersFlats,
  semitonesBetween,
  transposeChord,
  transposeKey,
} from "../../src/shared/transpose";

describe("KEYS", () => {
  it("lists the 12 major keys", () => {
    expect(KEYS).toEqual(["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]);
  });
});

describe("semitonesBetween", () => {
  it("measures upward distance using the root only", () => {
    expect(semitonesBetween("G", "A")).toBe(2);
    expect(semitonesBetween("A", "G")).toBe(10);
    expect(semitonesBetween("Em", "Gm")).toBe(3);
  });
  it("throws on an unknown key", () => {
    expect(() => semitonesBetween("H", "C")).toThrow();
  });
});

describe("prefersFlats", () => {
  it("is true for flat keys and flat minor keys", () => {
    for (const k of ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]) {
      expect(prefersFlats(k)).toBe(true);
    }
  });
  it("is false for sharp keys", () => {
    for (const k of ["C", "G", "D", "A", "E", "B", "Em", "Am"]) {
      expect(prefersFlats(k)).toBe(false);
    }
  });
});

describe("transposeKey", () => {
  it("transposes keys", () => {
    expect(transposeKey("G", 2)).toBe("A");
    expect(transposeKey("G", -2)).toBe("F");
    expect(transposeKey("C", 1)).toBe("Db");
    expect(transposeKey("Em", 1)).toBe("Fm");
  });
});

describe("transposeChord", () => {
  it("transposes roots, keeping suffixes", () => {
    expect(transposeChord("A7", 2, false)).toBe("B7");
    expect(transposeChord("Bbmaj7", 2, false)).toBe("Cmaj7");
    expect(transposeChord("F#m7b5", 1, false)).toBe("Gm7b5");
  });
  it("transposes slash bass and brackets", () => {
    expect(transposeChord("C/G", 2, false)).toBe("D/A");
    expect(transposeChord("(G)", 2, false)).toBe("(A)");
  });
  it("chooses flats or sharps", () => {
    expect(transposeChord("G", 3, true)).toBe("Bb");
    expect(transposeChord("G", 3, false)).toBe("A#");
  });
  it("returns non-chords unchanged", () => {
    expect(transposeChord("x2", 2, false)).toBe("x2");
    expect(transposeChord("N.C.", 2, false)).toBe("N.C.");
  });
  it("transposes chords with bracketed or unusual suffixes", () => {
    expect(transposeChord("C7(b9)", 2, false)).toBe("D7(b9)");
    expect(transposeChord("Am(maj7)", 2, false)).toBe("Bm(maj7)");
    expect(transposeChord("Cmaj7(9)", 2, false)).toBe("Dmaj7(9)");
    expect(transposeChord("Bm7(b5)", 1, false)).toBe("Cm7(b5)");
    expect(transposeChord("C(add9)", 2, false)).toBe("D(add9)");
    expect(transposeChord("(C7(b9))", 2, false)).toBe("(D7(b9))");
  });
  it("treats 6/9 as a suffix, not a slash bass", () => {
    expect(transposeChord("G6/9", 2, false)).toBe("A6/9");
    expect(transposeChord("G6/9/B", 2, false)).toBe("A6/9/C#");
  });
  it("leaves chords with an unknown root alone", () => {
    expect(transposeChord("Cb", 2, false)).toBe("Cb");
  });
});

describe("isValidKey", () => {
  it("accepts a root with an optional minor m", () => {
    for (const k of ["C", "F#", "Bb", "Em", "F#m", "Bbm", "Gb", "A#m"]) expect(isValidKey(k)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const k of ["", "H", "Cb", "Emaj", "C7", "c", "Am7", " G"]) expect(isValidKey(k)).toBe(false);
  });
});

describe("isChord", () => {
  it("accepts chords", () => {
    for (const t of ["G", "(G)", "C/G", "F#m7b5", "Bbmaj7", "A", "A7", "Em", "Cmaj7", "Gm7b5", "Dsus4", "Asus2", "Cadd9", "Bdim", "Caug", "C+", "Dm7", "G6", "E9", "A13", "D7sus4"]) expect(isChord(t)).toBe(true);
  });
  it("handles degree and o-slash suffixes", () => {
    expect(isChord("C°")).toBe(true);
    expect(isChord("Bø7")).toBe(true);
    expect(isChord("C�")).toBe(false);
  });
  it("rejects non-chords", () => {
    for (const t of ["x2", "|", "-", "day", "[Verse", "Bed", "Dead", "Dog", "Game", "Cat", "Chorus", "Bridge", "Coda", "Fade"]) expect(isChord(t)).toBe(false);
  });
});
