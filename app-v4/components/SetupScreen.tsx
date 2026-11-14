"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeNewTestnetName, suggestTestnetAccountId } from "@/lib/account-id";
import { IS_MAINNET, NETWORK_ID } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { createFundedAccount } from "@/lib/near/read";
import { connectWallet, connectedAccount, listWallets, type WalletOption } from "@/lib/near/wallet-connector";
import { startDemoSession } from "@/lib/client";
import { connectedSession, encryptSlot, sessionFromSlot, sessionFromVault, slotNeedsUpgrade, type Session } from "@/lib/session";
import type { StoredPolicy } from "@/lib/policy";
import { clearVault, loadVault, saveVault, type AccountSlot, type VaultRecord } from "@/lib/store";
import { MIN_PASSPHRASE, passphraseProblem } from "@/lib/vault";
import { Brand, Stage } from "./Chrome";
import { HoloOrb } from "./HoloOrb";

/**
 * Three ways in, and none of them asks for a private key:
 * - connect your own NEAR wallet (HOT, MyNearWallet, Intear): the wallet keeps the key and signs;
 * - create a fresh testnet account: the key is generated in this browser and encrypted here;
 * - try the shared demo: the testnet key stays on the server.
 * Pasting a secret key into the app is no longer offered. Wallets created earlier still unlock.
 */
export function SetupScreen({ onReady, onDemo, onConnected }: {
  onReady: (session: Session, vault: VaultRecord) => void;
  onDemo: (session: Session, policy: StoredPolicy) => void;
  onConnected: (session: Session) => void;
}) {
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [booted, setBooted] = useState(false);
  const [mode, setMode] = useState<"connect" | "create">("connect");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [forget, setForget] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [connected, setConnected] = useState<{ accountId: string; walletId: string } | null>(null);
  const [autoDemo] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1");
  const [demoBusy, setDemoBusy] = useState(autoDemo);
  const [busy, setBusy] = useState(false);
  const levelRef = useRef(0);

  useEffect(() => {
    setVault(loadVault());
    setBooted(true);
    let cancelled = false;
    void (async () => {
      try {
        const [options, account] = await Promise.all([listWallets(), connectedAccount()]);
        if (cancelled) return;
        setWallets(options);
        setConnected(account);
        // Coming back from a browser wallet's sign-in or signing page: continue straight into the app,
        // where the returned transaction hashes (or the cancellation) are reconciled.
        const params = new URLSearchParams(window.location.search);
        if (account && (params.has("account_id") || params.has("transactionHashes") || params.has("errorCode"))) {
          onConnected(connectedSession(account.accountId, account.walletId));
        }
      } catch (err) {
        if (!cancelled) {
          setWallets([]);
          setError(publicError(err));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the wallet list once
  }, []);

  async function connect(walletId: string) {
    setError(null);
    setBusy(true);
    setStatus("Opening your wallet…");
    try {
      const accountId = await connectWallet(walletId);
      if (!accountId) return; // the wallet redirected the page; we continue when it comes back
      onConnected(connectedSession(accountId, walletId));
    } catch (err) {
      setError(publicError(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!vault) return;
    setBusy(true);
    setError(null);
    try {
      const session = await sessionFromVault(vault, passphrase);
      let current = vault;
      // Re-encrypt v1 blobs (120k PBKDF2, no AAD) in the v2 format now that we hold the passphrase.
      if (slotNeedsUpgrade(vault.active) || slotNeedsUpgrade(vault.other)) {
        setStatus("Upgrading this wallet's encryption…");
        const active = await encryptSlot({ ...session, publicKey: session.fullPublicKey });
        let other = vault.other;
        if (other) {
          const otherSession = await sessionFromSlot(other, passphrase);
          other = await encryptSlot({ ...otherSession, publicKey: otherSession.fullPublicKey });
        }
        current = { ...vault, active, other };
        saveVault(current);
        setStatus(null);
      }
      onReady(session, current);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(false);
    }
  }

  function removeWallet() {
    if (!vault || forget !== vault.active.accountId) {
      setError("Type the stored account id to remove the wallet from this browser.");
      return;
    }
    clearVault();
    setVault(null);
    setForget("");
    setError(null);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const weak = passphraseProblem(passphrase);
    if (weak) {
      setError(weak);
      return;
    }
    if (passphrase !== confirm) {
      setError("The passphrase entries do not match.");
      return;
    }
    setBusy(true);
    try {
      const accountId = name.trim() ? normalizeNewTestnetName(name) : suggestTestnetAccountId();
      setStatus(`Asking the testnet faucet for ${accountId}…`);
      const created = await createFundedAccount(accountId);
      setStatus("Encrypting the full-access key in this browser…");
      const slot: AccountSlot = await encryptSlot({
        accountId: created.accountId,
        publicKey: created.publicKey,
        fullSecret: created.secretKey,
        agentPublicKey: null,
        agentSecret: null,
        passphrase,
      });
      const next: VaultRecord = { version: 1, active: slot, other: null, createdAt: new Date().toISOString() };
      saveVault(next);
      const session = await sessionFromVault(next, passphrase);
      onReady(session, next);
    } catch (err) {
      setError(publicError(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function tryDemo() {
    setError(null);
    setDemoBusy(true);
    try {
      const view = await startDemoSession();
      onDemo({
        accountId: view.accountId,
        fullPublicKey: view.publicKey || "",
        fullSecret: "",
        agentPublicKey: null,
        agentSecret: null,
        passphrase: "",
        mode: "demo",
        demoRecipient: view.recipientId,
      }, view.policy);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setDemoBusy(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      void tryDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start the shared demo once when deep-linked from the landing
  }, []);

  if (!booted || (autoDemo && demoBusy && !error)) {
    return (
      <Stage>
        <div className="grid h-full place-items-center gap-3">
          <HoloOrb state="thinking" levelRef={levelRef} onPress={() => undefined} />
          <p className="caption">{autoDemo ? "Opening the shared demo…" : ""}</p>
        </div>
      </Stage>
    );
  }

  if (vault) {
    return (
      <Stage>
        <header className="topbar"><Brand /></header>
        <div className="setup-scroll">
        <form className="card grid gap-3" onSubmit={unlock}>
          <p>This browser already holds <span className="mono">{vault.active.accountId}</span>. Enter the passphrase. The key is decrypted only in this tab.</p>
          <label className="grid gap-1 text-sm">
            Passphrase
            <input className="field" type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          </label>
          {status ? <p className="text-sm">{status}</p> : null}
          {error ? <p className="banner banner-danger" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Unlocking…" : "Unlock"}</button>
        </form>
        <form className="card grid gap-3" onSubmit={(event) => { event.preventDefault(); removeWallet(); }}>
          <p className="text-sm text-muted">Removing the wallet deletes the encrypted key from this browser. Funds stay on-chain only if you have the recovery key.</p>
          <label className="grid gap-1 text-sm">
            Type {vault.active.accountId} to remove it
            <input className="field mono" value={forget} onChange={(event) => setForget(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <button className="btn btn-ghost" type="submit">Remove wallet from this browser</button>
        </form>
        </div>
      </Stage>
    );
  }

  return (
    <Stage>
      <header className="topbar"><Brand /></header>
      <div className="setup-scroll">
      <div className="orb-wrap"><HoloOrb state="idle" levelRef={levelRef} onPress={() => undefined} /></div>
      <p className="caption">Just talk to me</p>
      <p className="text-center text-sm text-muted">Connect the NEAR wallet you already use. It keeps your key and shows its own confirmation; Vibe Wallet checks your limits before it asks. No private key is ever typed or pasted here.</p>
      {IS_MAINNET ? null : (
        <>
          <button className="btn btn-primary" type="button" data-testid="try-demo" disabled={demoBusy} onClick={() => void tryDemo()}>
            {demoBusy ? "Opening demo…" : "Try a demo account"}
          </button>
          <p className="text-center text-sm text-muted">The shared demo wallet is testnet-only, capped, rate-limited, and allowlisted. Its private key never reaches this browser.</p>
        </>
      )}
      <div className="flex gap-2">
        <button className={mode === "connect" ? "btn btn-primary" : "btn btn-ghost"} type="button" onClick={() => setMode("connect")} data-testid="mode-connect">Connect a wallet</button>
        {IS_MAINNET ? null : (
          <button className={mode === "create" ? "btn btn-primary" : "btn btn-ghost"} type="button" onClick={() => setMode("create")}>Create testnet account</button>
        )}
      </div>
      {mode === "connect" ? (
        <section className="card grid gap-3" data-testid="wallet-list">
          <h2 className="text-lg font-semibold">Connect a NEAR {NETWORK_ID} wallet</h2>
          {connected ? (
            <button className="btn btn-primary" type="button" onClick={() => onConnected(connectedSession(connected.accountId, connected.walletId))}>
              Continue as <span className="mono">{connected.accountId}</span>
            </button>
          ) : null}
          {wallets === null ? <p className="text-sm text-muted">Loading wallets…</p> : null}
          {wallets?.length === 0 ? <p className="text-sm">No wallet could be loaded in this browser.</p> : null}
          <ul className="grid gap-2">
            {(wallets ?? []).map((wallet) => (
              <li key={wallet.id}>
                <button className="btn btn-ghost flex w-full items-center gap-3" type="button" disabled={busy} onClick={() => void connect(wallet.id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons come from the wallet modules */}
                  <img src={wallet.iconUrl} alt="" width={24} height={24} />
                  <span className="grow text-left">{wallet.name}</span>
                  {wallet.type === "browser" ? <span className="text-xs text-muted">opens the wallet&apos;s page</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {status ? <p className="text-sm">{status}</p> : null}
          {error ? <p className="banner banner-danger" role="alert">{error}</p> : null}
          <p className="text-xs text-muted">Signing in shares only your account id: no function-call key is requested. Each payment opens your wallet to approve it.</p>
        </section>
      ) : (
        <form className="card grid gap-3" onSubmit={create}>
          <label className="grid gap-1 text-sm">
            Account name
            <input className="field" placeholder="Leave blank for a random vibe name" value={name} onChange={(event) => setName(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <PassphraseFields passphrase={passphrase} confirm={confirm} setPassphrase={setPassphrase} setConfirm={setConfirm} />
          {status ? <p className="text-sm">{status}</p> : null}
          {error ? <p className="banner banner-danger" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create testnet account"}</button>
          <p className="text-sm text-muted">The helper faucet creates and funds a named .testnet account. Its key is generated and encrypted in this browser; testnet NEAR has no monetary value.</p>
        </form>
      )}
      </div>
    </Stage>
  );
}

function PassphraseFields({ passphrase, confirm, setPassphrase, setConfirm }: {
  passphrase: string;
  confirm: string;
  setPassphrase: (value: string) => void;
  setConfirm: (value: string) => void;
}) {
  return (
    <>
      <label className="grid gap-1 text-sm">
        Passphrase (at least {MIN_PASSPHRASE} characters)
        <input className="field" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
        <span className="text-xs text-muted" aria-live="polite">
          {passphrase.length === 0 ? "Four random words are strong and easy to remember." : passphraseProblem(passphrase) ?? `Length ${passphrase.length}: OK.`}
        </span>
      </label>
      <label className="grid gap-1 text-sm">
        Confirm passphrase
        <input className="field" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </label>
    </>
  );
}
