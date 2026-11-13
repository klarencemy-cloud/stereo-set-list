import type { Config } from "@netlify/functions";
import type { BaseVersion, GigInput } from "../../src/shared/types";
import { guard, json, methodNotAllowed, noContent, notFound, readBody, routeParts } from "./lib/http";
import { blobsKV } from "./lib/kv";
import { makeRepo, type Repo } from "./lib/repo";

export function makeGigsHandler(repo: Repo) {
  return guard(async (req) => {
    const [id, extra] = routeParts(req);
    if (extra !== undefined) return notFound();
    if (id === undefined) {
      if (req.method === "GET") return json(await repo.listGigs());
      if (req.method === "POST") return json(await repo.createGig(await readBody<GigInput>(req)), 201);
      return methodNotAllowed();
    }
    if (req.method === "GET") {
      const g = await repo.getGig(id);
      return g ? json(g) : notFound();
    }
    if (req.method === "PUT") return json(await repo.updateGig(id, await readBody<Partial<GigInput> & BaseVersion>(req)));
    if (req.method === "DELETE") {
      await repo.deleteGig(id);
      return noContent();
    }
    return methodNotAllowed();
  });
}

export default (req: Request) => makeGigsHandler(makeRepo(blobsKV()))(req);

export const config: Config = { path: ["/api/gigs", "/api/gigs/:id"] };
