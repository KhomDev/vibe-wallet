import { Capacitor } from "@capacitor/core";

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const PREFERRED_VOICES = [
  /samantha \(enhanced\)|samantha \(premium\)/i,
  /\b(ava|zoe|evan|nathan|noelle|allison|tom) \((enhanced|premium)\)/i,
  /(enhanced|premium|neural|natural)/i,
  /google us english/i,
  /microsoft (aria|jenny|guy|ava|andrew|emma|brian) online/i,
  /^samantha$/i,
  /google uk english (female|male)/i,
];

let chosenVoice: SpeechSynthesisVoice | null | undefined;

/** Picks the most natural English voice the device offers. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang));
  for (const pattern of PREFERRED_VOICES) {
    const match = english.find((voice) => pattern.test(voice.name)) ?? english.find((voice) => pattern.test(voice.voiceURI));
    if (match) return match;
  }
  return english.find((voice) => /en[-_]us/i.test(voice.lang)) ?? english[0] ?? null;
}

function voice(): SpeechSynthesisVoice | null {
  if (!speechOutputSupported()) return null;
  if (chosenVoice) return chosenVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) chosenVoice = pickVoice(voices);
  return chosenVoice ?? null;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    chosenVoice = pickVoice(window.speechSynthesis.getVoices());
  });
}

export function voiceName(): string {
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) return "Android native TTS";
  return voice()?.name ?? "default";
}

/** In the Android APK, use the phone's native neural TTS (the WebView has no reliable speechSynthesis). */
async function nativeSpeak(text: string): Promise<boolean> {
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("TextToSpeech")) return false;
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.speak({ text, lang: "en-US", rate: 1.05, pitch: 0.92, volume: 1, category: "playback" });
    return true;
  } catch {
    return false;
  }
}

export function stopNativeSpeech(): void {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
  void import("@capacitor-community/text-to-speech").then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => undefined);
}

/** Speaks and resolves when done (or after a timeout, since iOS sometimes drops onend). */
export async function speakAsync(text: string): Promise<void> {
  if (!text.trim()) return;
  if (await nativeSpeak(text)) return;
  return browserSpeak(text);
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechOutputSupported() || !text.trim()) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const picked = voice();
    if (picked) utterance.voice = picked;
    utterance.lang = picked?.lang ?? "en-US";
    utterance.rate = 1.05;
    utterance.pitch = 0.92;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 1500 + text.length * 90);
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

export function speak(text: string): void {
  void speakAsync(text);
}

/** iOS only lets speech start from a tap; call this inside the tap handler. */
export function unlockSpeech(): void {
  if (!speechOutputSupported()) return;
  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
  stopNativeSpeech();
}

export type VoiceSession = {
  stop: () => void;
};

export function voiceInputSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pickRecorderFormat(): { mimeType?: string; ext: string } {
  const options = [
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "mp4" },
    { mimeType: "audio/mp4;codecs=mp4a.40.2", ext: "mp4" },
    { mimeType: "audio/aac", ext: "m4a" },
  ];
  if (typeof MediaRecorder !== "undefined") {
    for (const option of options) {
      try {
        if (MediaRecorder.isTypeSupported(option.mimeType)) return option;
      } catch {
        /* continue */
      }
    }
  }
  return isAppleMobile() ? { mimeType: "audio/mp4", ext: "mp4" } : { ext: "webm" };
}

function rmsLevel(data: Uint8Array): number {
  let sum = 0;
  for (const sample of data) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 5);
}

async function transcribeBlob(blob: Blob, ext: string): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, `clip.${ext}`);
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const payload = (await response.json()) as { text?: unknown; error?: unknown };
  if (typeof payload.text === "string" && payload.text.trim()) return payload.text.trim();
  const error = typeof payload.error === "string" ? payload.error : "I couldn't transcribe that. Try again, or type the command.";
  throw new Error(error);
}

function permissionMessage(err: unknown): string | null {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  const message = err && typeof err === "object" && "message" in err ? String((err as { message?: string }).message) : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /permission|not allowed|denied/i.test(message)
  ) {
    return "Microphone permission was denied. You can still type.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. You can still type.";
  }
  return null;
}

const MAX_MS = 8000;
const SILENCE_MS = 1400;
const MIN_MS = 700;
const SPEECH_LEVEL = 0.08;

export async function startVoiceInput(handlers: {
  onLevel: (level: number) => void;
  onTranscribing?: () => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): Promise<VoiceSession | null> {
  if (!voiceInputSupported()) {
    handlers.onError("This browser can't use the microphone. Type a command below, or tap a suggestion.");
    handlers.onEnd();
    return null;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (err) {
    handlers.onError(permissionMessage(err) ?? "The microphone could not be opened. You can still type.");
    handlers.onEnd();
    return null;
  }

  const format = pickRecorderFormat();
  let recorder: MediaRecorder;
  try {
    recorder = format.mimeType ? new MediaRecorder(stream, { mimeType: format.mimeType }) : new MediaRecorder(stream);
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      handlers.onError("This browser can't record audio. Type a command below, or tap a suggestion.");
      handlers.onEnd();
      return null;
    }
  }

  const chunks: Blob[] = [];
  let stopped = false;
  let finalized = false;
  let frame = 0;
  let maxTimer = 0;
  let silenceStarted = 0;
  let heardSpeech = false;
  const startedAt = Date.now();
  const mimeType = recorder.mimeType || format.mimeType || "audio/webm";
  const ext = mimeType.includes("mp4") || mimeType.includes("aac") || mimeType.includes("m4a") ? (format.ext === "webm" ? "mp4" : format.ext) : format.ext;

  const ctx = new AudioContext();
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* continue */
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  const cleanup = () => {
    cancelAnimationFrame(frame);
    if (maxTimer) window.clearTimeout(maxTimer);
    stream.getTracks().forEach((track) => track.stop());
    void ctx.close();
    handlers.onLevel(0);
  };

  const finish = (error?: string, text?: string) => {
    if (finalized) return;
    finalized = true;
    cleanup();
    if (error) handlers.onError(error);
    else if (text) handlers.onFinal(text);
    handlers.onEnd();
  };

  const stopRecording = () => {
    if (stopped) return;
    stopped = true;
    if (maxTimer) window.clearTimeout(maxTimer);
    cancelAnimationFrame(frame);
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        finish("I couldn't finish that recording. Try again, or type the command.");
      }
    }
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  recorder.onerror = () => {
    if (!finalized) finish("I couldn't finish that recording. Try again, or type the command.");
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 200) {
      finish("The recording was too short. Tap the orb and try again.");
      return;
    }
    handlers.onTranscribing?.();
    void transcribeBlob(blob, ext)
      .then((text) => finish(undefined, text))
      .catch((err) => finish(err instanceof Error ? err.message : "I couldn't transcribe that. Try again, or type the command."));
  };

  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    const level = rmsLevel(samples);
    handlers.onLevel(level);
    const elapsed = Date.now() - startedAt;
    if (level >= SPEECH_LEVEL) {
      heardSpeech = true;
      silenceStarted = 0;
    } else if (heardSpeech && elapsed >= MIN_MS) {
      if (!silenceStarted) silenceStarted = Date.now();
      else if (Date.now() - silenceStarted >= SILENCE_MS) {
        stopRecording();
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  };

  try {
    recorder.start(250);
  } catch {
    cleanup();
    handlers.onError("Voice input could not start. Type a command below, or tap a suggestion.");
    handlers.onEnd();
    return null;
  }

  frame = requestAnimationFrame(tick);
  maxTimer = window.setTimeout(stopRecording, MAX_MS);

  return { stop: stopRecording };
}
