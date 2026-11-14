/**
 * Hands-free conversation loop with a wake word.
 *
 * Wake word approach: energy-gated clips sent to NEAR AI Whisper. The mic is
 * analysed on the device; audio only leaves the phone when the voice activity
 * detector hears at least ~0.3 s of speech, and each clip is matched for
 * "hey vibe" (also "hey AI", "hey wallet", "yo vibe"). We chose this over the
 * Web Speech API because SpeechRecognition is missing in the Android WebView
 * and fails with "network" in several browsers, and over Porcupine because it
 * needs a per-developer access key and a custom-trained keyword file.
 *
 * Echo: the microphone is muted while the app is thinking or speaking, so
 * the wallet never hears itself. Screen Wake Lock keeps the screen on.
 */

export type HandsFreeState = "off" | "wake" | "listening" | "thinking" | "speaking";

export type HandsFreeReply = { speech: string; endSession?: boolean };

export type HandsFreeHandlers = {
  onState: (state: HandsFreeState) => void;
  onLevel: (level: number) => void;
  onHeard?: (text: string) => void;
  /** Handle a command and return what to say. */
  onCommand: (text: string) => Promise<HandsFreeReply>;
  speak: (text: string) => Promise<void>;
  onWake?: () => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

const WAKE = /\b(?:hey|hi|yo|ok(?:ay)?|hello)[\s,.!-]*(?:vibe|vibes|vibe wallet|vibewallet|a\.?i\.?|wallet)\b[\s,.!?-]*/i;
const WAKE_LOOSE = /^\s*(?:vibe wallet|hey vibe|yo vibe)\b[\s,.!?-]*/i;
const STOP = /^\s*(?:stop|stop listening|bye|bye bye|goodbye|good bye|see ya|see you|later|that's all|that is all|i'm done|im done)[\s.!]*$/i;
const HALLUCINATION = /^\s*(?:thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+|okay\.?|hmm+\.?|music|\[.*\]|\(.*\))\s*$/i;

export function matchWake(text: string): { woke: boolean; rest: string } {
  const m = text.match(WAKE) ?? text.match(WAKE_LOOSE);
  if (!m || m.index === undefined) return { woke: false, rest: "" };
  return { woke: true, rest: text.slice(m.index + m[0].length).trim() };
}

export function isStopPhrase(text: string): boolean {
  return STOP.test(text);
}

export function isLikelyHallucination(text: string): boolean {
  return !text.trim() || HALLUCINATION.test(text);
}

/**
 * Voice confirm answers. YES must be the whole utterance ("yes", "yes, do it", "confirm"), so
 * "ok", "go to history" or "sure, not now" never send. NO is checked first and matches a negative
 * anywhere in the answer.
 */
export const YES = /^\s*(?:yes|yeah|yep|yup|confirm|confirmed|send it|do it)(?:[\s,]+(?:please|send it|do it|confirm|confirmed))?[\s.!]*$/i;
export const NO = /\b(?:no|nope|nah|cancel|don't|dont|do not|never ?mind|wait|stop|not)\b/i;

export function isNegative(text: string): boolean {
  return NO.test(text.replace(/[‘’]/g, "'"));
}

/** Whole-utterance yes, and nothing negative in it. */
export function isAffirmative(text: string): boolean {
  return !isNegative(text) && YES.test(text.trim());
}

/** How long a "say yes to confirm" prompt stays armed. */
export const VOICE_CONFIRM_MS = 15_000;

const FOLLOW_UP_MS = 8000;
const SILENCE_MS = 1000;
const MIN_SPEECH_MS = 300;
const MAX_COMMAND_MS = 12000;
const MAX_WAKE_MS = 7000;
const WAKE_RECYCLE_MS = 6000;

function pickMime(): { mimeType?: string; ext: string } {
  const options = [
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "mp4" },
    { mimeType: "audio/aac", ext: "m4a" },
  ];
  for (const option of options) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(option.mimeType)) return option;
    } catch {
      /* next */
    }
  }
  return { ext: "mp4" };
}

async function transcribe(blob: Blob, ext: string): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, `clip.${ext}`);
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
  if (typeof payload.text === "string") return payload.text.trim();
  throw new Error(typeof payload.error === "string" ? payload.error : "Transcription failed.");
}

type WakeLockSentinelLike = { release: () => Promise<void> };

export class HandsFree {
  private handlers: HandsFreeHandlers;
  private running = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private abortCapture: (() => void) | null = null;
  private noiseFloor = 0.02;
  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.running) void this.lockScreen();
  };

  constructor(handlers: HandsFreeHandlers) {
    this.handlers = handlers;
  }

  get active(): boolean {
    return this.running;
  }

  /** Call from a tap: unlocks audio on iOS and asks for the mic. */
  async start(opts: { wakeWord: boolean; greeting?: string }): Promise<void> {
    if (this.running) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      this.handlers.onError("This browser can't do hands-free audio. You can still type.");
      return;
    }
    this.running = true;
    this.ctx = new AudioContext();
    try {
      await this.ctx.resume();
    } catch {
      /* ignore */
    }
    try {
      await this.openMic();
    } catch {
      this.running = false;
      this.handlers.onError("Mic permission is off. Allow it and try again.");
      this.handlers.onEnd();
      return;
    }
    await this.lockScreen();
    document.addEventListener("visibilitychange", this.onVisibility);
    if (opts.greeting) await this.say(opts.greeting);
    void this.loop(opts.wakeWord);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.abortCapture?.();
    this.closeMic();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.handlers.onLevel(0);
    this.handlers.onState("off");
    this.handlers.onEnd();
  }

  private async lockScreen(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
      if (nav.wakeLock) this.wakeLock = await nav.wakeLock.request("screen");
    } catch {
      /* not supported or denied; the session still works while the screen is on */
    }
  }

  private async openMic(): Promise<void> {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === "live")) {
      // Re-enable instead of re-opening: iOS may prompt again for a new getUserMedia.
      this.stream.getAudioTracks().forEach((track) => { track.enabled = true; });
      return;
    }
    this.stream = null;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
  }

  /** Mutes the mic while thinking or speaking so the wallet never hears itself. */
  private muteMic(): void {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = false; });
  }

  private closeMic(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
  }

  private async say(text: string): Promise<void> {
    if (!this.running) return;
    this.muteMic();
    this.handlers.onState("speaking");
    await this.handlers.speak(text);
  }

  private level(buf: Uint8Array): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (const sample of buf) {
      const c = (sample - 128) / 128;
      sum += c * c;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 5);
  }

  /**
   * Records one utterance. Resolves with a blob once speech is followed by
   * ~1 s of silence, or null when nobody spoke within `waitMs`.
   */
  private capture(waitMs: number, maxMs: number): Promise<{ blob: Blob; ext: string } | null> {
    return new Promise((resolve) => {
      if (!this.stream || !this.analyser) return resolve(null);
      const format = pickMime();
      let recorder: MediaRecorder;
      try {
        recorder = format.mimeType ? new MediaRecorder(this.stream, { mimeType: format.mimeType }) : new MediaRecorder(this.stream);
      } catch {
        return resolve(null);
      }
      const chunks: Blob[] = [];
      const buf = new Uint8Array(this.analyser.fftSize);
      const started = Date.now();
      let speechMs = 0;
      let speechStart = 0;
      let silenceStart = 0;
      let heard = false;
      let finished = false;
      let keep = false;
      const mime = recorder.mimeType || format.mimeType || "audio/webm";
      const ext = /mp4|aac|m4a/.test(mime) ? "mp4" : "webm";

      const end = (keepAudio: boolean) => {
        if (finished) return;
        finished = true;
        keep = keepAudio;
        window.clearInterval(timer);
        this.abortCapture = null;
        this.handlers.onLevel(0);
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            resolve(null);
          }
        } else resolve(null);
      };
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (!keep) return resolve(null);
        const blob = new Blob(chunks, { type: mime });
        resolve(blob.size > 400 ? { blob, ext } : null);
      };
      this.abortCapture = () => end(false);

      const timer = window.setInterval(() => {
        if (!this.running) return end(false);
        const lvl = this.level(buf);
        this.handlers.onLevel(lvl);
        const threshold = Math.max(0.07, this.noiseFloor * 2.6);
        const now = Date.now();
        if (lvl >= threshold) {
          if (!speechStart) speechStart = now;
          speechMs = now - speechStart;
          if (speechMs >= MIN_SPEECH_MS) heard = true;
          silenceStart = 0;
        } else {
          speechStart = 0;
          if (!heard) this.noiseFloor = this.noiseFloor * 0.95 + lvl * 0.05;
          if (heard) {
            if (!silenceStart) silenceStart = now;
            else if (now - silenceStart >= SILENCE_MS) return end(true);
          }
        }
        if (!heard && now - started >= waitMs) return end(false);
        if (heard && now - started >= maxMs) return end(true);
      }, 50);

      try {
        recorder.start(250);
      } catch {
        window.clearInterval(timer);
        resolve(null);
      }
    });
  }

  private async loop(wakeWord: boolean): Promise<void> {
    let mode: "wake" | "listening" = wakeWord ? "wake" : "listening";
    let followUpUntil = 0;
    while (this.running) {
      try {
        await this.openMic();
      } catch {
        this.handlers.onError("Lost the mic. Tap hands-free to start again.");
        this.stop();
        return;
      }
      this.handlers.onState(mode);
      const wait = mode === "wake" ? WAKE_RECYCLE_MS : wakeWord ? Math.max(1000, followUpUntil - Date.now()) : WAKE_RECYCLE_MS;
      const clip = await this.capture(wait, mode === "wake" ? MAX_WAKE_MS : MAX_COMMAND_MS);
      if (!this.running) return;
      if (!clip) {
        if (mode === "listening" && wakeWord && Date.now() >= followUpUntil) mode = "wake";
        continue;
      }
      this.muteMic();
      this.handlers.onState("thinking");
      let text = "";
      try {
        text = await transcribe(clip.blob, clip.ext);
      } catch {
        if (mode === "listening") await this.say("hmm, didn't catch that.");
        continue;
      }
      if (!this.running) return;
      if (isLikelyHallucination(text)) continue;
      this.handlers.onHeard?.(text);

      let command = text;
      if (mode === "wake") {
        const wake = matchWake(text);
        if (!wake.woke) continue;
        this.handlers.onWake?.();
        if (wake.rest.split(/\s+/).filter(Boolean).length < 2) {
          mode = "listening";
          followUpUntil = Date.now() + FOLLOW_UP_MS;
          continue;
        }
        command = wake.rest;
      } else {
        const wake = matchWake(text);
        if (wake.woke && wake.rest) command = wake.rest;
      }

      if (isStopPhrase(command)) {
        await this.say("later ✌️");
        this.stop();
        return;
      }
      this.handlers.onState("thinking");
      let reply: HandsFreeReply;
      try {
        reply = await this.handlers.onCommand(command);
      } catch {
        reply = { speech: "ugh, something broke. try again?" };
      }
      if (!this.running) return;
      if (reply.speech) await this.say(reply.speech);
      if (reply.endSession) {
        this.stop();
        return;
      }
      mode = "listening";
      followUpUntil = Date.now() + FOLLOW_UP_MS;
    }
  }
}
