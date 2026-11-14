import { NEAR_AI_BASE_URL, NEAR_AI_STT_MODEL } from "@/lib/config";
import { clientIp } from "@/lib/server/env";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_BYTES = 200;

function filenameFor(file: Blob, fallback: string): string {
  if (file instanceof File && file.name && file.name.includes(".")) return file.name;
  const type = (file.type || "").toLowerCase();
  if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) return "clip.mp4";
  if (type.includes("mpeg") || type.includes("mp3")) return "clip.mp3";
  if (type.includes("wav")) return "clip.wav";
  if (type.includes("ogg")) return "clip.ogg";
  return fallback;
}

function publicTranscribeError(status: number): string {
  if (status === 401 || status === 402) {
    return "Voice transcription is temporarily unavailable. Type the command instead.";
  }
  return "I couldn't transcribe that. Try again, or type the command.";
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Voice transcription is not configured. You can still type." }, { status: 503 });
  }
  // Each clip is a paid Whisper call: per-client and per-instance limits.
  const ip = clientIp(request);
  const mine = hit(`transcribe:${ip}`, ROUTE_LIMITS.transcribe);
  if (!mine.ok) return tooMany(mine.retryAfterSec, "Too many voice clips from this network. Wait a moment, or type the command.");
  const all = hit("transcribe:global", ROUTE_LIMITS.modelGlobal);
  if (!all.ok) return tooMany(60, "Voice transcription is busy right now. Type the command instead.");
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "That recording is too long. Try a shorter command." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "That recording could not be read. Try again, or type the command." }, { status: 400 });
  }

  const uploaded = form.get("audio") ?? form.get("file");
  if (!(uploaded instanceof Blob) || uploaded.size === 0) {
    return Response.json({ error: "No audio was uploaded. Tap the orb and try again." }, { status: 400 });
  }
  if (uploaded.size < MIN_BYTES) {
    return Response.json({ error: "The recording was too short. Tap the orb and try again." }, { status: 400 });
  }
  if (uploaded.size > MAX_BYTES) {
    return Response.json({ error: "That recording is too long. Try a shorter command." }, { status: 413 });
  }

  const filename = filenameFor(uploaded, "clip.webm");
  const outbound = new FormData();
  outbound.append("file", uploaded, filename);
  outbound.append("model", NEAR_AI_STT_MODEL);
  outbound.append("language", "en");
  outbound.append("response_format", "json");

  try {
    const response = await fetch(`${NEAR_AI_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: outbound,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return Response.json({ error: publicTranscribeError(response.status) }, { status: 200 });
    }
    const payload = (await response.json()) as { text?: unknown };
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return Response.json({ error: "I didn't catch that. Try again, or type the command." }, { status: 200 });
    }
    return Response.json({ text, source: "near-ai-whisper" });
  } catch {
    return Response.json({ error: "Voice transcription was unreachable. Type the command instead." }, { status: 200 });
  }
}
