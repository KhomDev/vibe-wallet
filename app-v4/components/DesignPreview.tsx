"use client";

import { useRef } from "react";
import { defaultStoredPolicy } from "@/lib/policy";
import { Brand, Stage, TabBar } from "./Chrome";
import { HoloOrb } from "./HoloOrb";
import { SlideConfirm } from "./SlideConfirm";
import { WalletTab } from "./WalletTab";
import { SafetyPanel } from "./SafetyPanel";

export function DesignPreview({ mode }: { mode: "orb" | "confirm" | "wallet" | "safety" }) {
  const levelRef = useRef(0);
  const policy = mode === "safety"
    ? { ...defaultStoredPolicy(), killed: true, allowlistOnly: true, perTxNear: "0.3", dailyNear: "2", allowlist: ["demo-recipient.testnet"] }
    : defaultStoredPolicy();
  const tab = mode === "wallet" || mode === "safety" ? "wallet" : "orb";
  return (
    <Stage>
      <header className="topbar">
        <Brand />
        <button className="icon-btn" type="button" aria-label="Start listening">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <rect x="6" y="2" width="6" height="9" rx="3" fill="none" stroke="#2c2a2e" strokeWidth="1.5" />
            <path d="M4 8.5a5 5 0 0 0 10 0M9 13.5V16" fill="none" stroke="#2c2a2e" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="pane">
        {mode === "safety" ? (
          <div className="grid gap-3">
            <div className="orb-wrap" style={{ minHeight: 160 }}>
              <HoloOrb state="blocked" levelRef={levelRef} onPress={() => undefined} />
            </div>
            <p className="caption">Blocked. The kill switch is on.</p>
            <p className="banner banner-danger" role="alert">Sending is stopped, including the demo agent. Limits still apply when sending is resumed.</p>
            <SafetyPanel
              policy={policy}
              spentTodayNear="0.15"
              keys={[]}
              accountId="demo-account.testnet"
              hasAgentKey={false}
              hasScopedKeyOnChain={false}
              busy={false}
              demo
              onChange={() => undefined}
              onAllow={() => undefined}
              onRemoveAllow={() => undefined}
              onAddScopedKey={() => undefined}
              onKill={() => undefined}
              onResume={() => undefined}
              onRefreshKeys={() => undefined}
              onScopedCall={() => undefined}
              onForget={() => undefined}
            />
          </div>
        ) : mode === "wallet" ? (
          <WalletTab
            accountId="your-account.testnet"
            availableNear={0}
            nearPrice={null}
            hidden={false}
            onToggleHidden={() => undefined}
            history={[]}
            quote={null}
            onSend={() => undefined}
            onReceive={() => undefined}
            onSwap={() => undefined}
            policy={policy}
            spentTodayNear="0"
            keys={[]}
            hasAgentKey={false}
            busy={false}
            onPolicy={() => undefined}
            onAllow={() => undefined}
            onRemoveAllow={() => undefined}
            onAddScopedKey={() => undefined}
            hasScopedKeyOnChain={false}
            onKill={() => undefined}
            onResume={() => undefined}
            onRefreshKeys={() => undefined}
            onScopedCall={() => undefined}
            onForget={() => undefined}
            onLock={() => undefined}
            otherAccount={null}
            onCreateRecipient={() => undefined}
            onSwitch={() => undefined}
          />
        ) : (
          <>
            {mode === "orb" ? (
              <div className="balance-block">
                <span className="num">0.00</span>
                <span className="unit">NEAR</span>
              </div>
            ) : null}
            <div className="orb-wrap">
              <HoloOrb state={mode === "confirm" ? "confirming" : "idle"} levelRef={levelRef} onPress={() => undefined} />
            </div>
            <p className="caption">
              {mode === "confirm" ? (
                <>
                  Send 0.2 NEAR to vibeeea7b54f.testnet?
                  <span className="fee">fee 0.00004463 NEAR</span>
                </>
              ) : "Just talk to me"}
            </p>
          </>
        )}
      </div>
      {mode === "confirm" ? (
        <div className="slider-shell">
          <SlideConfirm onConfirm={() => undefined} />
        </div>
      ) : null}
      <TabBar tab={tab} onChange={() => undefined} />
    </Stage>
  );
}
