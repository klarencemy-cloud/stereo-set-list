import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, noContent, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, ValidationError, type Repo } from "./lib/repo";

export function makeTracksHandler(repo: Repo) {
  return guard(async (req) => {
    const [id, sub, num, extra] = routeParts(req);
    if (id === undefined) {
      if (req.method === "GET") return json(await repo.listTracks());
      if (req.method === "POST") {
        const body = await readBody<{ title: string; size: number }>(req);
        return json(await repo.createTrack({ title: body?.title, size: body?.size }), 201);
      }
      return methodNotAllowed();
    }
    if (sub === undefined) {
      if (req.method === "DELETE") {
        await repo.deleteTrack(id);
        return noContent();
      }
      return methodNotAllowed();
    }
    if (sub !== "parts" || num === undefined || extra !== undefined) return notFound();
    const n = Number(num);
    if (!Number.isInteger(n)) throw new ValidationError("part number must be an integer");
    if (req.method === "PUT") {
      await repo.putTrackPart(id, n, await req.arrayBuffer());
      return noContent();
    }
    if (req.method === "GET") {
      const bytes = await repo.getTrackPart(id, n);
      return bytes ? new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } }) : notFound();
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeTracksHandler(makeRepo(blobsKV()))(req);

export const config: Config = { path: ["/api/tracks", "/api/tracks/:id", "/api/tracks/:id/parts/:n"] };
