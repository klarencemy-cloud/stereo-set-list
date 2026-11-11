import type { Config } from "@netlify/functions";
import { ImportError, importFromUg } from "./lib/ug";

const MESSAGES = {
  not_ug: "That link isn't an Ultimate Guitar chords page",
  blocked: "Couldn't read that page. Paste the chords instead.",
  parse: "Couldn't read that page. Paste the chords instead.",
} as const;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ code: "method", message: "Method not allowed" }, 405);
  let url: unknown;
  try {
    url = ((await req.json()) as { url?: unknown })?.url;
  } catch {
    url = undefined;
  }
  try {
    return json(await importFromUg(typeof url === "string" ? url : ""), 200);
  } catch (e) {
    if (e instanceof ImportError) return json({ code: e.code, message: MESSAGES[e.code] }, 422);
    throw e;
  }
};

export const config: Config = { path: "/api/import" };
