import type { Config } from "@netlify/functions";
import { guard, json, methodNotAllowed, noContent, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, ValidationError, type Repo } from "./lib/repo";

/** An upload that is still incomplete after this long is treated as abandoned. */
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export function makeTracksHandler(repo: Repo) {
  return guard(async (req) => {
    const [id, sub, num, extra] = routeParts(req);
    if (id === undefined) {
      if (req.method === "GET") {
        // Tidy up uploads that were started but never finished. Never let this break the list.
        await repo.purgeAbandonedTracks(ABANDONED_AFTER_MS).catch(() => {});
        return json(await repo.listTracks());
      }
      if (req.method === "POST") {
        const body = await readBody<{ title: string; size: number }>(req);
        return json(await repo.createTrack({ title: body?.title, size: body?.size }), 201);
      }
      return methodNotAllowed();
    }
    if (sub === undefined) {
      if (req.method === "GET") {
        const track = await repo.getTrack(id);
        return track ? json(track) : notFound();
      }
      if (req.method === "PUT") {
        const body = await readBody<{ title: string }>(req);
        return json(await repo.renameTrack(id, body?.title));
      }
      if (req.method === "DELETE") {
        await repo.deleteTrack(id);
        return noContent();
      }
      return methodNotAllowed();
    }
    if (sub === "song" && num === undefined) {
      if (req.method === "POST") return json(await repo.linkTrackSong(id));
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
      if (!bytes) return notFound();
      // Track ids are random and parts are never rewritten, so the browser can keep them for replays.
      // "private" keeps the Netlify CDN from serving a deleted track.
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" },
      });
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeTracksHandler(makeRepo(blobsKV()))(req);

export const config: Config = { path: ["/api/tracks", "/api/tracks/:id", "/api/tracks/:id/parts/:n", "/api/tracks/:id/song"] };
