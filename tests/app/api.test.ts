import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../../src/app/api";
import { FRESH_HEADER } from "../../src/sw/strategy";

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("api.getSong", () => {
  it("asks the offline worker for a fresh copy when told to", async () => {
    const fetch = stubFetch();
    await api.getSong("s1", { fresh: true });
    const init = fetch.mock.calls[0][1]!;
    expect(new Headers(init.headers).get(FRESH_HEADER)).toBe("1");
  });

  it("sends no fresh header by default", async () => {
    const fetch = stubFetch();
    await api.getSong("s1");
    const init = fetch.mock.calls[0][1];
    expect(new Headers(init?.headers).get(FRESH_HEADER)).toBeNull();
  });
});
