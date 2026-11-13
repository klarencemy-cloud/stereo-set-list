import { parseSheet } from "../../src/shared/sheet";
import { layoutTabs } from "../../src/app/components/tabLayout";

const tab = [
  "e|--0--1--|--2--3--|",
  "B|--1--2--|--3--4--|",
  "G|--2--3--|--4--5--|",
  "D|--3--4--|--5--6--|",
  "A|--4--5--|--6--7--|",
  "E|--5--6--|--7--8--|",
].join("\n");

const text = (l: ReturnType<typeof parseSheet>[number]) =>
  l.kind === "line" ? l.parts.map((p) => (p.type === "chord" ? p.chord : p.text)).join("") : l.label;

describe("layoutTabs", () => {
  it("returns lines untouched when they fit or width is unknown", () => {
    const lines = parseSheet(tab);
    expect(layoutTabs(lines, 80)).toEqual(lines);
    expect(layoutTabs(lines, Infinity)).toEqual(lines);
  });

  it("wraps the six strings together, not one string at a time", () => {
    const out = layoutTabs(parseSheet(tab), 10).map(text);
    expect(out).toEqual([
      "e|--0--1--",
      "B|--1--2--",
      "G|--2--3--",
      "D|--3--4--",
      "A|--4--5--",
      "E|--5--6--",
      "|--2--3--|",
      "|--3--4--|",
      "|--4--5--|",
      "|--5--6--|",
      "|--6--7--|",
      "|--7--8--|",
    ]);
  });

  it("keeps the chord row above the piece where each chord starts", () => {
    const content = `[ch]Bb[/ch]         [ch]Gm[/ch]\n${tab}`;
    const out = layoutTabs(parseSheet(content), 10);
    expect(out.map(text)[0]).toBe("Bb        ");
    expect(out.map(text)[7]).toBe(" Gm");
    const chordRows = out.filter((l) => l.kind === "line" && l.parts.some((p) => p.type === "chord"));
    expect(chordRows).toHaveLength(2);
  });

  it("leaves lyrics and chord lines alone", () => {
    const lines = parseSheet("[ch]G[/ch]  [ch]D[/ch]\nA long lyric line that is wider than ten columns");
    expect(layoutTabs(lines, 10)).toEqual(lines);
  });
});
