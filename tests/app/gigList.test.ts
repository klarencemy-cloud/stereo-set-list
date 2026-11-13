import { splitGigs } from "../../src/app/gigList";
import type { Gig } from "../../src/shared/types";

const g = (name: string, date: string, songIds: string[] = []) =>
  ({ id: name, name, date, songIds, setlist: [] }) as Gig;

describe("splitGigs", () => {
  it("puts today and later in upcoming, soonest first; earlier in past, newest first", () => {
    const { upcoming, past } = splitGigs(
      [g("A", "2026-12-01"), g("B", "2026-11-20"), g("T", "2026-11-12"), g("P1", "2026-10-01"), g("P2", "2026-11-01")],
      "2026-11-12",
    );
    expect(upcoming.map((x) => x.name)).toEqual(["T", "B", "A"]);
    expect(past.map((x) => x.name)).toEqual(["P2", "P1"]);
  });

  it("sorts gigs on the same date by name", () => {
    const { upcoming } = splitGigs([g("Zed", "2026-12-01"), g("Abe", "2026-12-01")], "2026-11-12");
    expect(upcoming.map((x) => x.name)).toEqual(["Abe", "Zed"]);
  });
});
