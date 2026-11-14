import { publicError } from "../errors";
import { AbortTransaction } from "./state";

/** JSON response that is never cached by a browser or CDN (some responses carry a cookie). */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const response = Response.json(data, init);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as T : null;
  } catch {
    return null;
  }
}

/** Maps an error to a status: limit refusals keep theirs, everything else is 400 or the fallback. */
export function errorResponse(err: unknown, fallback = 400): Response {
  if (err instanceof AbortTransaction) return json({ error: err.message, blocked: true }, { status: err.status });
  return json({ error: publicError(err) }, { status: fallback });
}
