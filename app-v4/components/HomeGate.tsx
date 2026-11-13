"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LandingPage } from "./LandingPage";
import { WalletApp } from "./WalletApp";

function shouldOpenApp() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("app") === "1") return true;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  if (standalone) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad|Mobile|IEMobile|Opera Mini/i.test(ua)) return true;
  return window.innerWidth < 900;
}

export function HomeGate() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"pending" | "landing" | "app">("pending");

  useEffect(() => {
    const apply = () => setMode(shouldOpenApp() ? "app" : "landing");
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("popstate", apply);
    };
  }, [searchParams]);

  if (mode === "pending") {
    return <div className="stage" aria-busy="true" aria-label="Vibe Wallet" />;
  }
  if (mode === "landing") return <LandingPage />;
  return <WalletApp />;
}
