// Edge-safe request checks used by middleware.ts. Kept separate so tests can import them.

const JSON_ROUTES = new Set(["/api/demo/send", "/api/demo/policy", "/api/agent/rules", "/api/intent", "/api/quote"]);
const MULTIPART_ROUTES = new Set(["/api/transcribe"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function checkApiRequest(input: {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (SAFE_METHODS.has(input.method) || input.pathname.startsWith("/api/cron/")) return { ok: true };
  const site = (input.secFetchSite || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") {
    return { ok: false, status: 403, error: "Cross-site requests are not accepted." };
  }
  if (input.origin && input.origin !== "null") {
    let originHost = "";
    try {
      originHost = new URL(input.origin).host;
    } catch {
      return { ok: false, status: 403, error: "Cross-site requests are not accepted." };
    }
    if (!input.host || originHost !== input.host) return { ok: false, status: 403, error: "Cross-site requests are not accepted." };
  } else if (input.origin === "null") {
    return { ok: false, status: 403, error: "Cross-site requests are not accepted." };
  }
  const type = (input.contentType || "").toLowerCase().split(";")[0].trim();
  if (JSON_ROUTES.has(input.pathname) && type !== "application/json") {
    return { ok: false, status: 415, error: "Send the request as application/json." };
  }
  if (MULTIPART_ROUTES.has(input.pathname) && type !== "multipart/form-data") {
    return { ok: false, status: 415, error: "Send the recording as multipart/form-data." };
  }
  return { ok: true };
}
