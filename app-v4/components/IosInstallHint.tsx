"use client";

import { useEffect, useState } from "react";

type Hint = "safari" | "chrome";

function detectIosHint(): Hint | null {
  if (typeof window === "undefined") return null;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  if (standalone) return null;
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return null;
  if (/CriOS/i.test(ua)) return "chrome";
  return "safari";
}

const COPY: Record<Hint, string> = {
  safari:
    "Add Vibe Wallet to your Home Screen: tap Share at the bottom, then Add to Home Screen.",
  chrome:
    "Add Vibe Wallet to your Home Screen: tap the Share icon in the address bar, then Add to Home Screen. Needs Chrome on iOS 16.4 or later.",
};

export function IosInstallHint() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("vibe.iosHint.dismissed") === "1") return;
    if (new URLSearchParams(window.location.search).has("preview")) return;
    setHint(detectIosHint());
  }, []);

  if (!hint) return null;

  return (
    <div className="ios-hint" role="note">
      <p>{COPY[hint]}</p>
      <button
        type="button"
        className="ios-hint-dismiss"
        onClick={() => {
          sessionStorage.setItem("vibe.iosHint.dismissed", "1");
          setHint(null);
        }}
      >
        OK
      </button>
    </div>
  );
}
