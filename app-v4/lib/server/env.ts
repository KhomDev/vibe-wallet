import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export function authorizedCron(request: Request, secret: string): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-cron-secret") || "";
  return bearer === secret || alt === secret;
}
