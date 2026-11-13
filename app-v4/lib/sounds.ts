const KEY = "vibe.muted";

let context: AudioContext | null = null;

export function soundMuted(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

export function setSoundMuted(muted: boolean): void {
  localStorage.setItem(KEY, muted ? "1" : "0");
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (soundMuted()) return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (!context) context = new AudioContext();
  return context;
}

export function pop(frequency = 640): void {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(frequency * 1.4, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
}

export function chime(): void {
  pop(520);
  window.setTimeout(() => pop(780), 90);
}

export function haptic(pattern: number | number[] = 12): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}
