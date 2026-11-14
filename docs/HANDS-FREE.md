# Hands-free mode and the "hey vibe" wake word

Tap the headset button (🎧) at the top of the Orb tab once. From then on the phone can lie on the table:

1. **Wake.** The orb idles and the bar says *Say "hey vibe"*. Also accepted: "hey AI", "hey wallet", "yo vibe" (and "hey vibe, what's my balance" in one breath).
2. **Listen.** A short chime plays, the orb switches to *Listening*, and the turn ends after about 1 second of silence.
3. **Think.** The clip is transcribed by NEAR AI Cloud Whisper and turned into an intent by NEAR AI (or the local parser).
4. **Speak.** The answer is read out loud in one short, casual sentence. Numbers are rounded ("about 4.7"), and fees, hashes and long account ids are never read out; they stay on screen.
5. **Follow up.** It listens again right away. After about 8 seconds with no follow-up it goes back to waiting for the wake word.

Say **"stop"** or **"bye"** to end the session, or tap the big red **Stop** button. "Stop sending" still turns on the kill switch.

## Voice confirm

Voice can confirm only one kind of send: **to an allowlisted recipient, below your extra-confirm threshold, within every limit** (on the demo: an allowlisted contact, under 0.2 NEAR).

- The wallet asks with the amount and the recipient: *"send 0.1 NEAR to bob? say yes to confirm, or no."*
- **Yes must be the whole answer:** "yes", "yeah", "yep", "yup", "confirm", "send it", "do it", or "yes, do it". "ok", "sure", "go", "go ahead", "absolutely" and anything longer ("go to history", "yes but later") do not send.
- **Negatives are checked first and win:** any "no", "nah", "cancel", "wait", "stop", "not" or "don't" in the answer cancels, so "sure, not now" cancels.
- **The question expires** after 15 seconds, when the card on screen changes, or when you say anything else. After that, "yes" means nothing until the wallet asks again.
- Everything else (a recipient not on your allowlist, an amount at or above the threshold, a typo of a contact, an implicit account) needs the on-screen slide, and the confirm phrase when the card asks for it. Voice can never approve those sends.
- A spoken confirm phrase fills in the phrase field only when the phrase is the **whole** utterance, never when a longer sentence happens to contain it. You still slide.
- The kill switch and all limits apply exactly as they do for typed commands.

## How the wake word works

The app runs a voice activity detector on the device (Web Audio analyser, adaptive noise floor). Audio is only uploaded when at least about 0.3 seconds of speech is detected. Each clip goes to NEAR AI Whisper, and the text is matched against the wake phrases. Common Whisper silence hallucinations ("Thank you.", "you") are ignored.

Why this approach:

- **Web Speech API** (`SpeechRecognition`) is missing in the Android WebView that the APK uses and fails with `network` errors in Brave, Edge and some networks, so it can't be the only path.
- **Picovoice Porcupine Web** needs a per-developer AccessKey and a custom-trained "hey vibe" keyword file. Neither is available for this build.
- **Energy-gated Whisper clips** work the same in iOS Safari, Android Chrome and the APK, and they only cost money when someone is actually talking. `/api/transcribe` is rate-limited per client (15 clips a minute, 200 a day).

## Echo and screen

- The microphone track is muted while the app is thinking or speaking, so the wallet never hears itself.
- A Screen Wake Lock keeps the screen on during a session. It is requested again when the tab becomes visible.

## Voice

NEAR AI Cloud has no text-to-speech model, and there is no TTS provider key in this project's environment. So the app picks the most natural voice the device has: Samantha or another "Enhanced/Premium" Apple voice first, then any "Natural/Neural" voice, then Google US English. It speaks at rate 1.05 with a slightly lower pitch (0.92). On iPhone, the "Enhanced" voices sound much better; you can download them in Settings → Accessibility → Spoken Content → Voices.

## Limitations

- **Screen off or app in the background:** no wake word. iOS suspends the microphone and audio for web apps and PWAs, and the Android WebView pauses capture in the background. Keep the app open with the screen on (the Wake Lock does that while the session runs).
- **iOS needs one tap to start.** Speech and microphone audio can only begin from a user gesture. The 🎧 tap does that.
- **The first session asks for microphone permission.** iOS may ask again after a page reload. In the APK, only the app's own origin can get the microphone (APK 1.2).
- **Cost and latency:** each spoken turn is one Whisper call (a few seconds of audio) plus one intent call. Silence costs nothing. Background chatter that sounds like speech can trigger a clip; it's discarded unless the wake phrase is in it.
- **Long implicit account ids can't be spoken reliably.** Use allowlisted named accounts, or tap **Send 0.1** on the "Who can I send to?" card.
