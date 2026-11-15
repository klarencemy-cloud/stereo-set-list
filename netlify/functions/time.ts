import type { Config } from "@netlify/functions";
import { guard, methodNotAllowed } from "./lib/http";

/** The server's clock, for the synced metronome's clock sync. `clock` is injectable for tests. */
export function makeTimeHandler(clock: () => number) {
  return guard(async (req) => {
    if (req.method !== "GET") return methodNotAllowed();
    return new Response(JSON.stringify({ now: clock() }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  });
}

export default makeTimeHandler(() => Date.now());

export const config: Config = { path: "/api/time" };
