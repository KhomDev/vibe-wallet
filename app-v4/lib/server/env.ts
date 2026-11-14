import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { NETWORK_ID } from "../config";

export type DemoSecrets = {
  accountId: string;
  secretKey: string;
  publicKey: string;
  recipientId: string;
  cronSecret: string;
};

type KeyFile = {
  accountId?: string;
  account_id?: string;
  implicit_account_id?: string;
  publicKey?: string;
  public_key?: string;
  secretKey?: string;
  private_key?: string;
  privateKey?: string;
};

function readJson(path: string): KeyFile | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as KeyFile;
  } catch {
    return null;
  }
}

function accountOf(file: KeyFile | null): string {
  if (!file) return "";
  return String(file.accountId || file.account_id || file.implicit_account_id || "").trim();
}

function secretOf(file: KeyFile | null): string {
  if (!file) return "";
  return String(file.secretKey || file.private_key || file.privateKey || "").trim();
}

function publicOf(file: KeyFile | null): string {
  if (!file) return "";
  return String(file.publicKey || file.public_key || "").trim();
}

function localDir(): string {
  return process.env.VIBE_SECRETS_DIR || "/workspace/secrets/vibe-wallet";
}

function loadLocal(): Partial<DemoSecrets> {
  const dir = localDir();
  const demo = readJson(join(dir, "demo-account.json"));
  const recv = readJson(join(dir, "recv-account.json"));
  let cronSecret = process.env.AGENT_CRON_SECRET || process.env.CRON_SECRET || "";
  try {
    const path = join(dir, "cron.secret");
    if (!cronSecret && existsSync(path)) cronSecret = readFileSync(path, "utf8").trim();
  } catch {
    // ignore
  }
  return {
    accountId: accountOf(demo),
    secretKey: secretOf(demo),
    publicKey: publicOf(demo),
    recipientId: accountOf(recv),
    cronSecret,
  };
}

export function getDemoSecrets(): DemoSecrets {
  const local = loadLocal();
  const accountId = (process.env.DEMO_NEAR_ACCOUNT_ID || local.accountId || "").trim();
  const secretKey = (process.env.DEMO_NEAR_PRIVATE_KEY || local.secretKey || "").trim();
  const publicKey = (process.env.DEMO_NEAR_PUBLIC_KEY || local.publicKey || "").trim();
  const recipientId = (process.env.DEMO_RECIPIENT_ACCOUNT_ID || local.recipientId || "").trim();
  const cronSecret = (process.env.AGENT_CRON_SECRET || process.env.CRON_SECRET || local.cronSecret || "").trim();
  if (!accountId || !secretKey || !recipientId) {
    throw new Error("The demo account is not configured on this server.");
  }
  return { accountId, secretKey, publicKey, recipientId, cronSecret };
}

/** The network the demo signer is allowed to sign on. The shared demo is testnet, always. */
export const DEMO_NETWORK = "testnet" as const;

let verifiedChain: Promise<void> | null = null;

/**
 * Refuses to let the shared demo key sign anywhere but testnet: the build must be configured for
 * testnet and the RPC node must report chain_id "testnet". The RPC answer is cached per process.
 */
export async function assertDemoNetwork(): Promise<void> {
  if (NETWORK_ID !== DEMO_NETWORK) {
    throw new Error("The shared demo account only signs on testnet. This deployment is configured for another network, so demo sends are off.");
  }
  if (!verifiedChain) {
    verifiedChain = (async () => {
      const { getProvider } = await import("../near/read");
      const status = await getProvider().viewNodeStatus();
      if (status.chain_id !== DEMO_NETWORK) {
        throw new Error(`The RPC node reports chain "${status.chain_id}", not testnet. Demo sends are off.`);
      }
    })().catch((err) => {
      verifiedChain = null;
      throw err;
    });
  }
  return verifiedChain;
}

/** Test hook: forget the cached chain check. */
export function resetDemoNetworkCheck(): void {
  verifiedChain = null;
}

/**
 * Canonical client address for rate limits. On Vercel the platform sets x-real-ip and overwrites
 * x-forwarded-for, so client-supplied values do not reach us; elsewhere only the right-most
 * x-forwarded-for entry (appended by the nearest proxy) is trusted. IPv6 addresses are reduced to
 * their /64 prefix so one host cannot rotate through its own subnet.
 */
export function clientIp(request: Request): string {
  const headers = request.headers;
  let raw = "";
  if (process.env.VERCEL) {
    raw = headers.get("x-real-ip") || (headers.get("x-vercel-forwarded-for") || "").split(",")[0] || (headers.get("x-forwarded-for") || "").split(",")[0] || "";
  } else {
    const chain = (headers.get("x-forwarded-for") || "").split(",").map((part) => part.trim()).filter(Boolean);
    raw = chain[chain.length - 1] || headers.get("x-real-ip") || "";
  }
  return canonicalIp(raw);
}

export function canonicalIp(raw: string): string {
  let ip = raw.trim();
  if (!ip) return "unknown";
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(":")[0];
  ip = ip.replace(/%.*$/, "").toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind === 6) return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
  return "unknown";
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  return groups.map((group) => group.padStart(4, "0"));
}

function sameSecret(given: string, secret: string): boolean {
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(secret).digest();
  return timingSafeEqual(left, right) && given.length === secret.length;
}

/** Vercel Cron and the operator send `Authorization: Bearer <CRON_SECRET>`. */
export function authorizedCron(request: Request, secret: string): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = (request.headers.get("x-cron-secret") || "").trim();
  return (bearer !== "" && sameSecret(bearer, secret)) || (alt !== "" && sameSecret(alt, secret));
}

/** Operator actions (the global kill switch) use the same secret as the cron. */
export const authorizedOperator = authorizedCron;
