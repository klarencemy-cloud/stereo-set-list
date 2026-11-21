import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, StartNotApplied, type Repo } from "./lib/repo";
import type { MetroAnswer, MetroSession } from "../../src/shared/metronome";

/**
 * A session answer (see MetroAnswer), with the server's time read as it answers. A browser must never reuse it: the
 * session changes under it.
 */
function live(session: MetroSession | null, clock: () => number, { applied }: { applied?: boolean } = {}): Response {
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
    if (req.method === "GET") {
      // `?seen=1`: a joined phone's check, which keeps the session from going stale.
      const seen = new URL(req.url).searchParams.get("seen") === "1";
      const session = await repo.getMetronome(songId, clock(), { seen });
      return live(session, clock);
    }
    if (req.method === "PUT") {
      const body = await readBody<{ running?: unknown }>(req);
      // A start's answer says whether it was applied (see MetroChange.onlyIfStopped).
      const isStart = body.running === true;
      let session: MetroSession | null;
      try {
        session = await repo.setMetronome(songId, body, clock());
      } catch (e) {
        if (e instanceof StartNotApplied) return live(e.current, clock, { applied: false });
        throw e;
      }
      return live(session, clock, { applied: isStart ? true : undefined });
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeMetronomeHandler(makeRepo(blobsKV()), () => Date.now())(req);

export const config: Config = { path: "/api/metronome/:songId" };
