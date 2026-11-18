import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, type Repo } from "./lib/repo";
import type { MetroAnswer, MetroSession } from "../../src/shared/metronome";

/**
 * A session answer (see MetroAnswer), with the server's time read as it answers. A browser must never reuse it:
 * the session changes under it, and its time is a clock sample.
 */
function live(session: MetroSession | null, clock: () => number): Response {
  const answer: MetroAnswer = { session, now: clock() };
  const res = json(answer);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** A song's shared metronome session. All times are on `clock`, the server's clock (injectable for tests). */
export function makeMetronomeHandler(repo: Repo, clock: () => number) {
  return guard(async (req) => {
    const [songId, extra] = routeParts(req);
    if (songId === undefined || extra !== undefined) return notFound();
    if (req.method === "GET") {
      // `?seen=1`: a joined phone's check, which keeps the session from going stale.
      const seen = new URL(req.url).searchParams.get("seen") === "1";
      return live(await repo.getMetronome(songId, clock(), { seen }), clock);
    }
    if (req.method === "PUT") return live(await repo.setMetronome(songId, await readBody(req), clock()), clock);
    return methodNotAllowed();
  });
}

export default (req: Request) => makeMetronomeHandler(makeRepo(blobsKV()), () => Date.now())(req);

export const config: Config = { path: "/api/metronome/:songId" };
