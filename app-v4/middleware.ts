import { NextResponse, type NextRequest } from "next/server";
import { IS_MAINNET } from "./lib/config";
import { checkApiRequest, isTestnetOnlyRoute } from "./lib/request-guard";

// Every state-changing API call must come from this site, and JSON routes must say they are JSON.
// That blocks cross-site form posts and `text/plain` "simple requests" (CSRF) on all routes,
// including the paid model proxies. The cron route authenticates with a bearer secret instead.

function reject(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
}

export function middleware(request: NextRequest): NextResponse {
  const verdict = checkApiRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("x-forwarded-host") || request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
  });
  if (!verdict.ok) return reject(verdict.status, verdict.error);
  if (IS_MAINNET && isTestnetOnlyRoute(request.nextUrl.pathname)) {
    return reject(404, "This is a NEAR mainnet deployment: there is no shared demo account or demo agent. Connect your own NEAR wallet.");
  }
  const response = NextResponse.next();
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = { matcher: "/api/:path*" };
