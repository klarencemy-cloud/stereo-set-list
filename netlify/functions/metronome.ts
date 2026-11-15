import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, type Repo } from "./lib/repo";

/** A response a browser must never reuse: the session changes under it. */
function live(body: unknown): Response {
  const res = json(body);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** A song's shared metronome session. All times are on `clock`, the server's clock (injectable for tests). */
export function makeMetronomeHandler(repo: Repo, clock: () => number) {
  return guard(async (req) => {
    const [songId, extra] = routeParts(req);
    if (songId === undefined || extra !== undefined) return notFound();
    if (req.method === "GET") return live(await repo.getMetronome(songId, clock()));
    if (req.method === "PUT") return live(await repo.setMetronome(songId, await readBody(req), clock()));
    return methodNotAllowed();
  });
}

export default (req: Request) => makeMetronomeHandler(makeRepo(blobsKV()), () => Date.now())(req);

export const config: Config = { path: "/api/metronome/:songId" };
