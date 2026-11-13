import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Each demo visitor gets a signed, httpOnly cookie. Their daily spend and send rate are counted
// against that id, so one visitor can't use up the shared demo for everyone else. If there is no
// valid cookie (first request, cookies blocked, or a forged value), we count against the IP instead.
export const VISITOR_COOKIE = "vw_vid";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function visitorSecret(seed: string): string {
  const explicit = (process.env.DEMO_VISITOR_SECRET || "").trim();
  return explicit || createHash("sha256").update(`vibe-wallet-visitor:${seed}`).digest("hex");
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url").slice(0, 32);
}

export function newVisitorId(): string {
  return randomBytes(16).toString("base64url");
}

export function signVisitor(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

export function verifyVisitor(value: string | undefined | null, secret: string): string | null {
  if (!value) return null;
  const [id, sig, extra] = value.split(".");
  if (!id || !sig || extra !== undefined || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function visitorCookieHeader(id: string, secret: string, secure = true): string {
  return `${VISITOR_COOKIE}=${signVisitor(id, secret)}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function shortHash(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
}

export type Visitor = {
  /** Key for per-visitor limits: "v:<hash>" with a valid cookie, otherwise "ip:<hash>". */
  key: string;
  /** Key for the looser per-network ceiling that applies to everyone on that IP. */
  ipKey: string;
  /** True when a valid signed cookie identified the visitor. */
  fromCookie: boolean;
  /** Set-Cookie value to send when the visitor has no valid cookie yet. */
  setCookie?: string;
};

export function resolveVisitor(request: Request, ip: string, secret: string): Visitor {
  const ipKey = `net:${shortHash(ip, secret)}`;
  const id = verifyVisitor(readCookie(request.headers.get("cookie"), VISITOR_COOKIE), secret);
  const secure = new URL(request.url).protocol === "https:";
  if (id) return { key: `v:${shortHash(id, secret)}`, ipKey, fromCookie: true };
  return {
    key: `ip:${shortHash(ip, secret)}`,
    ipKey,
    fromCookie: false,
    setCookie: visitorCookieHeader(newVisitorId(), secret, secure),
  };
}

export function withVisitorCookie(response: Response, visitor: Visitor): Response {
  if (visitor.setCookie) response.headers.append("set-cookie", visitor.setCookie);
  return response;
}
