export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string): void {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function speechInputSupported(): boolean {
  return ctor() !== null;
}

export function startListening(handlers: {
  continuous?: boolean;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): Recognition | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = handlers.continuous ?? true;
  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const piece = event.results[index][0]?.transcript ?? "";
      if (event.results[index].isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim) handlers.onInterim(interim);
    if (finalText.trim()) handlers.onFinal(finalText.trim());
  };
  recognition.onerror = (event) => {
    const code = event.error ?? "unknown";
    if (code === "no-speech" || code === "aborted") return;
    handlers.onError(
      code === "not-allowed"
        ? "Microphone permission was denied. You can still type."
        : `Voice input stopped (${code}). You can still type.`,
    );
  };
  recognition.onend = () => handlers.onEnd();
  recognition.start();
  return recognition;
}

export async function startLevelMeter(onLevel: (level: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((track) => track.stop());
    void ctx.close();
  };
}
