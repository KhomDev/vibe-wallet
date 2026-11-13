"use client";

import { motion } from "framer-motion";
import { haptic, pop } from "@/lib/sounds";
import { IosInstallHint } from "./IosInstallHint";

export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="stage">
      <div className="phone">
        <IosInstallHint />
        {children}
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <path d="M11 1.5 12.6 8.2 19.5 11 12.6 13.8 11 20.5 9.4 13.8 2.5 11 9.4 8.2Z" fill="#2c2a2e" />
      </svg>
      <div>
        <strong>Vibe Wallet</strong>
        <small>AI VOICE WALLET</small>
      </div>
    </div>
  );
}

export function TabBar({ tab, onChange }: { tab: "orb" | "wallet"; onChange: (tab: "orb" | "wallet") => void }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {(["orb", "wallet"] as const).map((id) => (
        <button
          key={id}
          className={tab === id ? "tab on" : "tab"}
          type="button"
          onClick={() => {
            pop(id === "orb" ? 520 : 440);
            haptic(8);
            onChange(id);
          }}
        >
          {tab === id ? (
            <motion.span
              layoutId="tab-pill"
              className="tab-pill"
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            />
          ) : null}
          {id === "orb" ? <MiniOrb /> : <WalletIcon />}
          <span>{id === "orb" ? "Orb" : "Wallet"}</span>
        </button>
      ))}
    </nav>
  );
}

function MiniOrb() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <defs>
        <radialGradient id="mini" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#ffd0dc" />
          <stop offset="100%" stopColor="#b7f6ea" />
        </radialGradient>
      </defs>
      <circle cx="9" cy="9" r="7" fill="url(#mini)" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="2" y="4" width="14" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 7.5h14" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
