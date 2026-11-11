import { NotFoundError, ValidationError } from "./repo";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const noContent = () => new Response(null, { status: 204 });
export const notFound = () => json({ message: "Not found" }, 404);
export const methodNotAllowed = () => json({ message: "Method not allowed" }, 405);

/** Path segments after `/api/<resource>`, e.g. /api/tracks/abc/parts/2 -> ["abc","parts","2"]. */
export function routeParts(req: Request): string[] {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  return segs.slice(2).map(decodeURIComponent);
}

export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

/** Wrap a handler so repo errors become HTTP responses. */
export function guard(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ValidationError) return json({ message: e.message }, 400);
      if (e instanceof NotFoundError) return json({ message: e.message }, 404);
      throw e;
    }
  };
}
