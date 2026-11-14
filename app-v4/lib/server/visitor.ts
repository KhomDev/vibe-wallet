import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type AgentState, transact, utcDay } from "./state";

// Each demo visitor gets a signed, httpOnly cookie. Their daily spend and send rate are counted
// against that id. Ids are free to verify but not free to mint: a network can mint at most
// `mintsPerNetworkPerDay` ids per UTC day, and every id on a network also shares that network's
// send and NEAR budget. Without a valid cookie a request is counted against its network.
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
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function visitorCookieHeader(id: string, secret: string, secure = true): string {
  return `${VISITOR_COOKIE}=${signVisitor(id, secret)}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function shortHash(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
}

export type Visitor = {
  /** Key for per-visitor limits: "v:<hash>" with a valid cookie, otherwise "ip:<hash>". */
  key: string;
  /** Key for the per-network budget that every visitor on that IP shares. */
  ipKey: string;
  /** True when a valid signed cookie identified the visitor. */
  fromCookie: boolean;
  /** Set-Cookie value to send when a new id was minted for this request. */
  setCookie?: string;
};

/** Identifies the caller without minting anything. */
export function resolveVisitor(request: Request, ip: string, secret: string): Visitor {
  const ipKey = `net:${shortHash(ip, secret)}`;
  const id = verifyVisitor(readCookie(request.headers.get("cookie"), VISITOR_COOKIE), secret);
  if (id) return { key: `v:${shortHash(id, secret)}`, ipKey, fromCookie: true };
  return { key: `ip:${shortHash(ip, secret)}`, ipKey, fromCookie: false };
}

export function mintAllowed(state: AgentState, ipKey: string, limit: number, now = new Date()): boolean {
  const entry = state.mints[ipKey];
  const count = entry && entry.day === utcDay(now) ? entry.count : 0;
  return count < limit;
}

/**
 * Like resolveVisitor, but a caller with no valid cookie gets a new signed id if their network has
 * minted fewer than `limit` ids today. Past the limit they stay on the shared network key.
 */
export async function identifyVisitor(request: Request, ip: string, secret: string, limit: number): Promise<Visitor & { minted: boolean; mintLimited: boolean }> {
  const visitor = resolveVisitor(request, ip, secret);
  if (visitor.fromCookie) return { ...visitor, minted: false, mintLimited: false };
  const { result: allowed } = await transact((state) => {
    if (!mintAllowed(state, visitor.ipKey, limit)) return { state, result: false };
    const day = utcDay();
    const entry = state.mints[visitor.ipKey];
    const count = entry && entry.day === day ? entry.count : 0;
    return { state: { ...state, mints: { ...state.mints, [visitor.ipKey]: { day, count: count + 1 } } }, result: true };
  });
  if (!allowed) return { ...visitor, minted: false, mintLimited: true };
  const id = newVisitorId();
  const secure = new URL(request.url).protocol === "https:";
  return {
    key: `v:${shortHash(id, secret)}`,
    ipKey: visitor.ipKey,
    fromCookie: false,
    setCookie: visitorCookieHeader(id, secret, secure),
    minted: true,
    mintLimited: false,
  };
}

export function withVisitorCookie(response: Response, visitor: Pick<Visitor, "setCookie">): Response {
  if (visitor.setCookie) response.headers.append("set-cookie", visitor.setCookie);
  return response;
}
