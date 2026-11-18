import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, StartNotApplied, type Repo } from "./lib/repo";
import type { MetroAnswer, MetroSession } from "../../src/shared/metronome";

/**
 * A session answer (see MetroAnswer), with the server's time read as it answers. A browser must never reuse it:
 * the session changes under it, and its time is a clock sample.
 */
function live(session: MetroSession | null, clock: () => number, applied?: boolean): Response {
  const answer: MetroAnswer = { session, now: clock(), ...(applied === undefined ? {} : { applied }) };
  const res = json(answer);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** A song's shared metronome session. All times are on `clock`, the server's clock (injectable for tests). */
export function makeMetronomeHandler(repo: Repo, clock: () => number) {
  return guard(async (req) => {
    const [songId, extra] = routeParts(req);
    if (songId === undefined || extra !== undefined) return notFound();
    if (req.method === "GET") return live(await repo.getMetronome(songId, clock()), clock);
    if (req.method === "PUT") {
      const body = await readBody<{ running?: unknown }>(req);
      // A start's answer says whether it was applied (see MetroChange.onlyIfStopped).
      const isStart = body.running === true;
      try {
        return live(await repo.setMetronome(songId, body, clock()), clock, isStart ? true : undefined);
      } catch (e) {
        if (e instanceof StartNotApplied) return live(e.current, clock, false);
        throw e;
      }
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeMetronomeHandler(makeRepo(blobsKV()), () => Date.now())(req);

export const config: Config = { path: "/api/metronome/:songId" };
