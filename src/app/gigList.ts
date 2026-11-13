import type { Gig } from "../shared/types";

const byDateThenName = (a: Gig, b: Gig) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name);

/** Upcoming = date >= today (soonest first); past = earlier (newest first). Dates are "YYYY-MM-DD". */
export function splitGigs(gigs: Gig[], today: string): { upcoming: Gig[]; past: Gig[] } {
  const upcoming = gigs.filter((g) => g.date >= today).sort(byDateThenName);
  const past = gigs.filter((g) => g.date < today).sort((a, b) => byDateThenName(b, a));
  return { upcoming, past };
}
