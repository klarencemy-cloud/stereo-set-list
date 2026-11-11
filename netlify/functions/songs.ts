import type { Config } from "@netlify/functions";
import type { SongInput } from "../../src/shared/types";
import { guard, json, methodNotAllowed, noContent, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, type Repo } from "./lib/repo";

export function makeSongsHandler(repo: Repo) {
  return guard(async (req) => {
    const [id, extra] = routeParts(req);
    if (extra !== undefined) return notFound();
    if (id === undefined) {
      if (req.method === "GET") return json(await repo.listSongs());
      if (req.method === "POST") return json(await repo.createSong(await readBody<SongInput>(req)), 201);
      return methodNotAllowed();
    }
    if (req.method === "GET") {
      const s = await repo.getSong(id);
      return s ? json(s) : notFound();
    }
    if (req.method === "PUT") return json(await repo.updateSong(id, await readBody<Partial<SongInput>>(req)));
    if (req.method === "DELETE") {
      await repo.deleteSong(id);
      return noContent();
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeSongsHandler(makeRepo(blobsKV()))(req);

export const config: Config = { path: ["/api/songs", "/api/songs/:id"] };
