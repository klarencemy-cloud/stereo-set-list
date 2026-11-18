import type { Config } from "@netlify/functions";
import { purgeCache } from "@netlify/functions";
import { guard, json, methodNotAllowed, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, StartNotApplied, type Repo } from "./lib/repo";
import type { MetroAnswer, MetroSession } from "../../src/shared/metronome";

/**
 * The environment switch for shared answers (#25), off unless set to "1", "true" or "on". Turn it on only after
 * the hand test on a deploy preview passes (#26).
 */
export const SHARED_ANSWERS_ENV = "METRONOME_SHARED_ANSWERS";

export const sharedAnswersOn = (value: string | undefined) => ["1", "true", "on"].includes((value ?? "").trim().toLowerCase());

/** The cache tag a song's check answers are shared under. */
export const metronomeTag = (songId: string) => `metronome-${encodeURIComponent(songId)}`;

/**
 * Shared answers: phones checking the same song share one answer from Netlify's cache for about 1 s, so fewer of
 * their checks reach the function. `purge` clears a cache tag; a stored change clears its song's.
 */
export interface SharedAnswers {
  purge: (tag: string) => Promise<void>;
}

/**
 * A session answer (see MetroAnswer), with the server's time read as it answers. A browser must never reuse it:
 * the session changes under it, and its time is a clock sample. A check's answer with a `cacheTag` (its song's) may
 * be shared by Netlify's cache for 1 s, and says so.
 */
function live(
  session: MetroSession | null,
  clock: () => number,
  { applied, cacheTag }: { applied?: boolean; cacheTag?: string } = {},
): Response {
  const answer: MetroAnswer = {
    session,
    now: clock(),
    ...(applied === undefined ? {} : { applied }),
    ...(cacheTag === undefined ? {} : { shared: true as const }),
  };
  const res = json(answer);
  if (cacheTag === undefined) {
    res.headers.set("Cache-Control", "no-store");
  } else {
    res.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.headers.set("Netlify-CDN-Cache-Control", "public, durable, s-maxage=1, must-revalidate");
    res.headers.set("Netlify-Cache-Tag", cacheTag);
  }
  return res;
}

/**
 * A song's shared metronome session. All times are on `clock`, the server's clock (injectable for tests). With
 * `shared` (the switch on), check answers may be shared from Netlify's cache and changes clear them.
 */
export function makeMetronomeHandler(repo: Repo, clock: () => number, shared?: SharedAnswers) {
  /** Clears the song's shared answers after a stored change. A failure leaves them to expire (1 s). */
  async function purgeShared(songId: string) {
    if (!shared) return;
    try {
      await shared.purge(metronomeTag(songId));
    } catch (e) {
      console.error("metronome: couldn't clear the shared answers", e);
    }
  }
  return guard(async (req) => {
    const [songId, extra] = routeParts(req);
    if (songId === undefined || extra !== undefined) return notFound();
    if (req.method === "GET") {
      // `?seen=1`: a joined phone's check, which keeps the session from going stale.
      const seen = new URL(req.url).searchParams.get("seen") === "1";
      const session = await repo.getMetronome(songId, clock(), { seen });
      return live(session, clock, { cacheTag: shared ? metronomeTag(songId) : undefined });
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
      await purgeShared(songId);
      return live(session, clock, { applied: isStart ? true : undefined });
    }
    return methodNotAllowed();
  });
}

export default (req: Request) =>
  makeMetronomeHandler(
    makeRepo(blobsKV()),
    () => Date.now(),
    sharedAnswersOn(process.env[SHARED_ANSWERS_ENV]) ? { purge: (tag) => purgeCache({ tags: [tag] }) } : undefined,
  )(req);

export const config: Config = { path: "/api/metronome/:songId" };
