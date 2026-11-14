"use client";

import { useEffect, useRef, useState } from "react";
import { suggestTestnetAccountId } from "@/lib/account-id";
import { shortAccount } from "@/lib/allowlist";
import { addAgentRule, previewDemoSend, requestQuote, resolveIntent, runAgentNow, sendDemoTransfer, updateDemoPolicy, fetchAgentStatus, type IntentSource, type QuoteView } from "@/lib/client";
import type { AgentLog, AgentRule } from "@/lib/agent-types";
import { explorerAccountUrl, explorerTxUrl, IS_MAINNET, NETWORK_ID, SCOPED_CONTRACT_ID, SWAP_MAX_NEAR, WRAP_CONTRACT_ID } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { explainTransaction, mergeHistory, type HistoryItem } from "@/lib/history";
import type { WalletIntent } from "@/lib/intent";
import { accountExists, createFundedAccount, estimateTransferFee, fetchHistory, getProvider, isScopedKey, listKeys, readBalance, type BalanceView, type KeySummary } from "@/lib/near/read";
import { addScopedKey, executePrepared, executeScopedCall, executeTransfer, SendError } from "@/lib/near/signer";
import { disconnectWallet, takeWalletRedirect, walletSend } from "@/lib/near/wallet-connector";
import { walletTransfer } from "@/lib/near/wallet-send";
import { buildSwapTransactions, readSwapChainState, requestLiveQuote, submitDeposit, verifyLiveQuote, waitForSwap } from "@/lib/intents-swap-client";
import { assessSend, assessSwap, normalizePhrase, phraseMatches, toPolicy, type StoredPolicy } from "@/lib/policy";
import { encryptSlot, isConnectedSession, isDemoSession, sessionFromSlot, slotFromSession, type Session } from "@/lib/session";
import { addSpend, clearVault, loadActivity, loadPendingSend, loadPolicy, loadRedirectPending, loadSpend, rememberActivity, savePendingSend, savePolicy, saveVault, type VaultRecord } from "@/lib/store";
import { formatNear, parseNear } from "@/lib/units";
import { chime, haptic, pop, setSoundMuted, soundMuted } from "@/lib/sounds";
import { speak, speakAsync, startVoiceInput, stopSpeaking, unlockSpeech, voiceInputSupported } from "@/lib/voice";
import { HandsFree, isAffirmative, isNegative, VOICE_CONFIRM_MS, type HandsFreeReply, type HandsFreeState } from "@/lib/handsfree";
import { speakNumber, toSpeech } from "@/lib/speech-text";
import { ActionCards, type Pending, type ReceiptView } from "./ActionCards";
import { BubbleBurst } from "./BubbleBurst";
import { Brand, Stage, TabBar } from "./Chrome";
import { CountUp } from "./CountUp";
import { HoloOrb, type OrbState } from "./HoloOrb";
import { SlideConfirm } from "./SlideConfirm";
import { DesignPreview } from "./DesignPreview";
import { SetupScreen } from "./SetupScreen";
import { WalletTab } from "./WalletTab";
import { AgentPanel } from "./AgentPanel";
import { AllowlistCard } from "./AllowlistCard";
import { OnChainLimitsCard } from "./OnChainLimitsCard";

type Turn = { id: string; role: "user" | "assistant"; text: string; source?: IntentSource; note?: string | null };

const AGENT_DEMO_ONLY = "the agent runs on the shared demo account only. open the demo to try scheduled payments and price rules.";
const STORAGE_DEPOSIT_NOTE = "storage deposits";

async function view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  return (await getProvider().callFunction({ contractId, method, args })) as unknown as T;
}
const PENDING_SEND_MS = 15 * 60 * 1000;
const EXAMPLES = [
  "What's my balance?",
  "Send 0.5 NEAR to bob.testnet",
  "Swap 1 NEAR to USDT",
  "Explain my last transaction",
  "Show my history",
];

export function WalletApp() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [policy, setPolicy] = useState<StoredPolicy>(loadPolicy());
  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [spent, setSpent] = useState(0n);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [phrase, setPhrase] = useState("");
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [allowCard, setAllowCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<IntentSource | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<"done" | null>(null);
  const [tab, setTab] = useState<"orb" | "wallet">("orb");
  const [hidden, setHidden] = useState(false);
  const [muted, setMuted] = useState(false);
  const [nearPrice, setNearPrice] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | "receive" | "swap">(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [swapAmount, setSwapAmount] = useState("1");
  const [swapSymbol, setSwapSymbol] = useState<"USDT" | "USDC" | "ETH">("USDT");
  const [agentRules, setAgentRules] = useState<AgentRule[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [globalKilled, setGlobalKilled] = useState(false);
  const [limitsRefresh, setLimitsRefresh] = useState(0);
  const [swapStatusText, setSwapStatusText] = useState<string | null>(null);
  const busyRef = useRef(busy);
  const sessionRef = useRef(session);
  const vaultRef = useRef(vault);
  const policyRef = useRef(policy);
  const pendingRef = useRef(pending);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const confirmRef = useRef<() => Promise<void>>(async () => {});
  const handleRef = useRef<(text: string) => Promise<void>>(async () => {});
  const sayRef = useRef<(text: string, source: IntentSource | null, note: string | null, speech?: string) => void>(() => {});
  const lastSpeechRef = useRef("");
  const convoRef = useRef<HandsFree | null>(null);
  // A spoken "yes" confirms only the card it was asked about, and only for VOICE_CONFIRM_MS.
  const voiceConfirmRef = useRef<{ card: Pending; until: number } | null>(null);
  const handleTextRef = useRef<(raw: string) => Promise<void>>(async () => {});
  const [convo, setConvo] = useState<HandsFreeState>("off");
  const [wakeWord, setWakeWord] = useState(true);
  const [heard, setHeard] = useState<string | null>(null);
  const levelRef = useRef(0);
  const handsFreeRef = useRef(false);
  const levelStopRef = useRef<(() => void) | null>(null);
  const startMicRef = useRef<() => void>(() => {});
  const composerRef = useRef<HTMLInputElement | null>(null);
  const welcomedRef = useRef(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  busyRef.current = busy;
  sessionRef.current = session;
  vaultRef.current = vault;
  policyRef.current = policy;
  pendingRef.current = pending;

  useEffect(() => {
    setPolicy(loadPolicy());
    setMuted(soundMuted());
    setPreview(new URLSearchParams(window.location.search).get("preview"));
    setReady(true);
    void fetch("https://1click.chaindefuser.com/v0/tokens")
      .then((response) => response.json())
      .then((tokens: { assetId?: string; price?: number }[]) => {
        const near = tokens.find((token) => token.assetId === "nep141:wrap.near");
        if (typeof near?.price === "number") setNearPrice(near.price);
      })
      .catch(() => setNearPrice(null));
  }, []);

  useEffect(() => {
    if (!session) return;
    const accountId = session.accountId;
    let cancelled = false;
    void (async () => {
      try {
        const [nextBalance, remote, nextKeys] = await Promise.all([
          readBalance(accountId),
          fetchHistory(accountId).catch(() => [] as HistoryItem[]),
          listKeys(accountId).catch(() => [] as KeySummary[]),
        ]);
        if (cancelled) return;
        setBalance(nextBalance);
        setHistory(mergeHistory(remote, loadActivity(accountId)));
        setKeys(nextKeys);
        if (isDemoSession(sessionRef.current)) {
          const agent = await fetchAgentStatus().catch(() => null);
          if (agent && !cancelled) {
            setAgentRules(agent.rules);
            setAgentLogs(agent.logs);
            setGlobalKilled(agent.globalKilled);
          }
        } else {
          setSpent(loadSpend(accountId));
          if (isConnectedSession(sessionRef.current)) {
            const returned = await handleWalletReturn(accountId);
            if (returned && !cancelled) sayRef.current(returned, null, null);
          }
          const settled = await reconcilePendingSend(accountId);
          if (settled && !cancelled) sayRef.current(settled, null, null);
        }
      } catch (err) {
        if (!cancelled) setError(publicError(err));
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!session || !isDemoSession(session) || !balance || welcomedRef.current) return;
    welcomedRef.current = true;
    sayRef.current(
      `yo, demo wallet's ready with ${balance.availableNear} NEAR. tap, type, or talk.`,
      null,
      null,
    );
  }, [session, balance]);

  // Re-checks a send whose outcome was unknown (timeout after broadcast). Returns a message once it settles.
  async function reconcilePendingSend(accountId: string): Promise<string | null> {
    const entry = loadPendingSend(accountId);
    if (!entry) return null;
    if (!entry.hash) {
      // Waiting for a browser wallet that never came back: keep the spend counted, forget the record later.
      if (Date.now() - entry.at > PENDING_SEND_MS) savePendingSend(accountId, null);
      return null;
    }
    try {
      const found = await getProvider().viewTransactionStatus({ txHash: entry.hash, accountId, waitUntil: "EXECUTED" }) as unknown as { status?: unknown };
      savePendingSend(accountId, null);
      const failed = Boolean(found.status && typeof found.status === "object" && "Failure" in found.status);
      if (failed) addSpend(accountId, -BigInt(entry.amountYocto));
      setSpent(loadSpend(accountId));
      return failed ? `your earlier send to ${entry.recipient} failed on chain, nothing moved.` : `your earlier send to ${entry.recipient} went through.`;
    } catch {
      if (Date.now() - entry.at > PENDING_SEND_MS) {
        savePendingSend(accountId, null);
        return null;
      }
      return null;
    }
  }

  // A browser wallet (MyNearWallet) signs on its own page and sends the user back with the result.
  async function handleWalletReturn(accountId: string): Promise<string | null> {
    const result = takeWalletRedirect();
    const pendingRecord = loadRedirectPending();
    if (!result || !pendingRecord || pendingRecord.accountId !== accountId) return null;
    const { entry } = pendingRecord;
    if (result.error || !result.hashes.length) {
      addSpend(accountId, -BigInt(entry.amountYocto));
      savePendingSend(accountId, null);
      setSpent(loadSpend(accountId));
      return entry.depositAddress ? "swap cancelled in your wallet, nothing moved." : "cancelled in your wallet, nothing sent.";
    }
    const hash = result.hashes[result.hashes.length - 1];
    savePendingSend(accountId, null);
    setSpent(loadSpend(accountId));
    if (entry.depositAddress) {
      void finishSwap(entry.depositAddress, hash, entry.toSymbol || "");
      return "wallet signed the swap deposit. waiting for NEAR Intents to settle…";
    }
    setReceipt({ hash, recipient: entry.recipient, amountNear: formatNear(BigInt(entry.amountYocto)), feeNear: "" });
    setFlash("done");
    window.setTimeout(() => setFlash(null), 8000);
    return `done, your wallet sent ${formatNear(BigInt(entry.amountYocto))} to ${entry.recipient} ✌️`;
  }

  async function finishSwap(depositAddress: string, depositTx: string, toSymbol: string) {
    await submitDeposit({ txHash: depositTx, depositAddress });
    setSwapStatusText("Swap deposited. Waiting for NEAR Intents…");
    const final = await waitForSwap(depositAddress, (status) => setSwapStatusText(`Swap status: ${status}`));
    setSwapStatusText(null);
    const accountId = sessionRef.current?.accountId;
    if (accountId) setBalance(await readBalance(accountId).catch(() => null));
    const out = final.detail && typeof final.detail === "object" ? String((final.detail as Record<string, unknown>).amountOutFormatted ?? "") : "";
    sayRef.current(
      final.success
        ? `swap done ✅ ${out ? `${out} ${toSymbol} ` : ""}delivered to your account.`
        : final.status === "REFUNDED"
          ? "the swap was refunded to your account, nothing lost but gas."
          : `swap status: ${final.status}. check the explorer link.`,
      null,
      null,
    );
    rememberLocal({
      hash: depositTx,
      signer: accountId ?? "",
      receiver: WRAP_CONTRACT_ID,
      actions: ["FUNCTION_CALL"],
      methods: ["ft_transfer"],
      depositYocto: null,
      feeYocto: null,
      success: final.success,
      timestampMs: Date.now(),
      source: "local",
    });
    setReceipt({ hash: depositTx, recipient: depositAddress, amountNear: "swap", feeNear: "" });
    setFlash(final.success ? "done" : null);
  }

  // Executed NEAR Intents swap (mainnet). The quote is verified against the request, the exact
  // transactions are built and shown, and the policy treats it like a send to an unknown account.
  async function draftSwap(current: Session, amountNear: string, toSymbol: "USDT" | "USDC" | "ETH", nextSource: IntentSource, nextNote: string | null) {
    setBusy("Asking NEAR Intents for an executable quote…");
    const amountYocto = parseNear(amountNear);
    const quote = await requestLiveQuote({ accountId: current.accountId, amountNear, toSymbol });
    const problems = verifyLiveQuote(quote, { accountId: current.accountId, amountYocto, toSymbol });
    if (problems.length) {
      say(`swap refused: ${problems[0].toLowerCase()}`, nextSource, nextNote);
      return;
    }
    const [chain, nextBalance, feeYocto] = await Promise.all([
      readSwapChainState(view, current.accountId, quote.destinationAsset, WRAP_CONTRACT_ID),
      readBalance(current.accountId),
      estimateTransferFee(false),
    ]);
    if (!nextBalance) throw new Error("Your account is not visible on mainnet.");
    setBalance(nextBalance);
    const built = buildSwapTransactions(quote, current.accountId, chain, WRAP_CONTRACT_ID);
    const check = assessSwap(toPolicy(policyRef.current), {
      amountYocto,
      extraYocto: built.attachedYocto > amountYocto ? built.attachedYocto - amountYocto : 0n,
      feeYocto: feeYocto * 8n,
      availableYocto: BigInt(nextBalance.availableYocto),
      spentTodayYocto: loadSpend(current.accountId),
      maxSwapYocto: parseNear(SWAP_MAX_NEAR),
    });
    setQuote(null);
    setPending({ kind: "swap", quote, transactions: built.transactions, attachedYocto: built.attachedYocto.toString(), amountYocto: amountYocto.toString(), check });
    setPhrase("");
    say(check.blockReason
      ? `nah, blocked: ${check.blockReason.replace(/\.$/, "").toLowerCase()}.`
      : `real swap: ${quote.amountInFormatted} NEAR for about ${quote.amountOutFormatted} ${toSymbol}. type the phrase, then slide.`, nextSource, nextNote);
    setTab("orb");
  }

  async function executeSwap(current: Session, card: Extract<Pending, { kind: "swap" }>, policyNow: ReturnType<typeof toPolicy>) {
    if (Date.parse(card.quote.deadline) < Date.now() + 60_000) throw new Error("This quote is about to expire. Ask for the swap again.");
    const amountYocto = BigInt(card.amountYocto);
    const [nextBalance, feeYocto] = await Promise.all([readBalance(current.accountId), estimateTransferFee(false)]);
    const check = assessSwap(policyNow, {
      amountYocto,
      extraYocto: BigInt(card.attachedYocto) - amountYocto,
      feeYocto: feeYocto * 8n,
      availableYocto: BigInt(nextBalance?.availableYocto ?? "0"),
      spentTodayYocto: loadSpend(current.accountId),
      maxSwapYocto: parseNear(SWAP_MAX_NEAR),
    });
    if (check.blockReason) throw new Error(check.blockReason);
    const destination = card.quote.destinationAsset.replace(/^nep141:/, "");
    let hashes: string[] = [];
    let reserved = false;
    const reserve = () => {
      addSpend(current.accountId, amountYocto);
      reserved = true;
      savePendingSend(current.accountId, { hash: "", recipient: card.quote.depositAddress, amountYocto: card.amountYocto, at: Date.now(), viaRedirect: true, depositAddress: card.quote.depositAddress, toSymbol: card.quote.toSymbol });
    };
    try {
      if (isConnectedSession(current)) {
        setBusy("Approve the swap in your wallet…");
        reserve();
        const outcome = await walletSend(current.accountId, card.transactions);
        if (outcome.redirected) return; // continues in handleWalletReturn
        hashes = outcome.hashes;
      } else {
        setBusy("Signing the swap in this browser…");
        const sent = await executePrepared({
          accountId: current.accountId,
          fullSecret: current.fullSecret,
          expectedPublicKey: current.fullPublicKey,
          transactions: card.transactions,
          allowedReceivers: [WRAP_CONTRACT_ID, destination],
          userConfirmed: true,
          onBeforeBroadcast: reserve,
        });
        hashes = sent.map((item) => item.hash);
      }
    } catch (err) {
      if (reserved && !(err instanceof SendError && err.outcome === "unknown")) {
        addSpend(current.accountId, -amountYocto);
        savePendingSend(current.accountId, null);
      }
      setSpent(loadSpend(current.accountId));
      throw err;
    }
    savePendingSend(current.accountId, null);
    setSpent(loadSpend(current.accountId));
    setPending(null);
    const depositTx = hashes[hashes.length - 1];
    if (!depositTx) throw new Error("The wallet did not return a transaction hash. Check your history.");
    say(`swap deposit sent (${depositTx.slice(0, 8)}…). waiting for NEAR Intents to settle.`, null, null);
    await finishSwap(card.quote.depositAddress, depositTx, card.quote.toSymbol);
  }

  async function addScopedKeyNow() {
    const current = sessionRef.current;
    if (!current || isDemoSession(current)) return;
    setBusy("Adding a function-call key that cannot transfer NEAR…");
    try {
      const existingKeys = await listKeys(current.accountId);
      const existing = existingKeys.find(isScopedKey);
      if (existing) {
        await persistSession({ ...current, agentPublicKey: existing.publicKey });
        setKeys(existingKeys);
        say("a scoped key is already on this account.", null, null);
        return;
      }
      const added = await addScopedKey({
        accountId: current.accountId,
        fullSecret: current.fullSecret,
        expectedPublicKey: current.fullPublicKey,
      });
      const latest = sessionRef.current;
      if (!latest || latest.accountId !== current.accountId) return;
      await persistSession({ ...latest, agentPublicKey: added.agentPublicKey, agentSecret: added.agentSecret });
      setKeys(await listKeys(current.accountId));
      rememberLocal({
        hash: added.hash,
        signer: current.accountId,
        receiver: current.accountId,
        actions: ["ADD_KEY"],
        methods: [],
        depositYocto: null,
        feeYocto: null,
        success: true,
        timestampMs: Date.now(),
        source: "local",
      });
      say(`Scoped key added. Transaction ${added.hash}.`, null, null);
    } finally {
      setBusy(null);
    }
  }

  async function persistSession(next: Session) {
    const currentVault = vaultRef.current;
    if (!currentVault) return;
    const nextVault = { ...currentVault, active: await slotFromSession(next) };
    saveVault(nextVault);
    vaultRef.current = nextVault;
    setVault(nextVault);
    setSession(next);
  }

  function commitPolicy(next: StoredPolicy, confirmPhrase?: string) {
    const current = sessionRef.current;
    if (isDemoSession(current)) {
      // Demo: only this visitor's own stop switch changes. Resuming needs the phrase on the server too.
      const previous = policyRef.current;
      policyRef.current = next;
      setPolicy(next);
      void updateDemoPolicy({ killed: next.killed, phrase: confirmPhrase }).then((view) => {
        policyRef.current = view.policy;
        setPolicy(view.policy);
        setGlobalKilled(view.globalKilled);
      }).catch((err) => {
        policyRef.current = previous;
        setPolicy(previous);
        setError(publicError(err));
      });
      return;
    }
    policyRef.current = next;
    setPolicy(next);
    savePolicy(next);
  }

  function pushTurn(turn: Omit<Turn, "id">) {
    setTurns((current) => [...current, { ...turn, id: crypto.randomUUID() }].slice(-30));
  }

  function say(text: string, nextSource: IntentSource | null, nextNote: string | null, speech?: string) {
    pushTurn({ role: "assistant", text, source: nextSource ?? undefined, note: nextNote });
    const spoken = speech ?? toSpeech(text);
    lastSpeechRef.current = spoken;
    // In hands-free mode the conversation loop speaks, so the mic is muted first.
    if (!convoRef.current?.active) speak(spoken);
  }
  sayRef.current = say;

  function rememberLocal(item: HistoryItem) {
    const accountId = sessionRef.current?.accountId;
    if (!accountId) return;
    const local = rememberActivity(accountId, item);
    setHistory((current) => mergeHistory(current.filter((row) => row.source === "indexer"), local));
  }

  async function refreshBalance() {
    const accountId = sessionRef.current?.accountId;
    if (!accountId) throw new Error("Unlock the wallet first.");
    const next = await readBalance(accountId);
    setBalance(next);
    if (!next) throw new Error("The account is not visible on testnet.");
    return next;
  }

  async function refreshHistory() {
    const accountId = sessionRef.current?.accountId;
    if (!accountId) return [];
    const remote = await fetchHistory(accountId).catch(() => [] as HistoryItem[]);
    const merged = mergeHistory(remote, loadActivity(accountId));
    setHistory(merged);
    return merged;
  }

  async function handleText(raw: string) {
    const text = raw.trim();
    const current = sessionRef.current;
    if (!text || !current) return;
    if (busyRef.current) {
      setError("Still working on the last request.");
      return;
    }
    setDraft("");
    setInterim("");
    setError(null);
    setVoiceHint(null);
    setAllowCard(false);
    pushTurn({ role: "user", text });
    setBusy("Reading your request…");
    try {
      const resolved = await resolveIntent(text, current.accountId);
      setSource(resolved.source);
      setNote(resolved.note);
      await applyIntent(resolved.intent, resolved.source, resolved.note);
    } catch (err) {
      const message = publicError(err);
      setError(message);
      say(message, null, null);
    } finally {
      setBusy(null);
    }
  }

  function sendLine(check: { blockReason: string | null; needsPhrase: boolean }, amountNear: string, recipient: string): string {
    if (check.blockReason) return `nah, blocked: ${check.blockReason.replace(/\.$/, "").toLowerCase()}.`;
    return check.needsPhrase
      ? `${amountNear} NEAR to ${recipient}? type the phrase, then slide.`
      : `${amountNear} NEAR to ${recipient}? slide to send.`;
  }

  async function applyIntent(intent: WalletIntent, nextSource: IntentSource, nextNote: string | null) {
    const current = sessionRef.current;
    if (!current) return;
    if (intent.type === "stop") {
      commitPolicy({ ...policyRef.current, killed: true });
      setPending(null);
      say("kill switch on 🛑 nothing leaves, balance and quotes still work.", nextSource, nextNote);
      return;
    }
    if (intent.type === "get_balance") {
      const next = await refreshBalance();
      say(`yo, you've got ${next.availableNear} NEAR to spend.`, nextSource, nextNote);
      return;
    }
    if (intent.type === "history") {
      const items = await refreshHistory();
      say(items.length ? `found ${items.length} recent txs, newest is up top.` : "no txs yet, pretty quiet.", nextSource, nextNote);
      setTab("wallet");
      return;
    }
    if (intent.type === "explain_last") {
      const items = await refreshHistory();
      say(items[0] ? explainTransaction(items[0], current.accountId) : "can't see any tx on this account yet.", nextSource, nextNote, items[0] ? "here's your last tx, details on screen." : undefined);
      return;
    }
    if (intent.type === "onchain_limits") {
      setLimitsRefresh((value) => value + 1);
      setTab("wallet");
      say("those limits live in a TriagePay contract, so the chain enforces them. details are in the wallet tab.", nextSource, nextNote);
      return;
    }
    if (intent.type === "quote_swap") {
      if (IS_MAINNET && !isDemoSession(current)) {
        await draftSwap(current, intent.amountNear, intent.toSymbol, nextSource, nextNote);
        return;
      }
      const nextQuote = await requestQuote({ accountId: current.accountId, amountNear: intent.amountNear, toSymbol: intent.toSymbol });
      setQuote(nextQuote);
      say(`quote only: ${nextQuote.amountInFormatted} NEAR gets you about ${nextQuote.amountOutFormatted} ${nextQuote.destinationSymbol}, nothing signed.`, nextSource, nextNote);
      return;
    }
    if (intent.type === "show_allowlist") {
      const current = policyRef.current;
      setQuote(null);
      setAllowCard(true);
      const list = current.allowlist;
      say(
        list.length
          ? `you can send to ${list.length} ${list.length === 1 ? "account" : "accounts"}, up to ${current.perTxNear} NEAR a pop.`
          : `allowlist's empty, say "allow name.testnet" to add someone.`,
        nextSource,
        nextNote,
      );
      return;
    }
    if (intent.type === "help" || intent.type === "show_safety") {
      say("try balance, send 0.1 to bob, a swap quote, or stop sending to freeze.", nextSource, nextNote);
      return;
    }
    if (intent.type === "resume") {
      if (isDemoSession(current) && globalKilled) {
        say("the operator paused the whole demo, so sending can't be turned back on from here.", nextSource, nextNote);
        return;
      }
      setPending({ kind: "resume" });
      setPhrase("");
      say("type your confirm phrase to turn sending back on.", nextSource, nextNote);
      return;
    }
    if (intent.type === "allow") {
      setPending({ kind: "allow", recipient: intent.recipient });
      setPhrase("");
      say(`add ${intent.recipient} to your allowlist? type the phrase to lock it in.`, nextSource, nextNote);
      return;
    }
    if (intent.type === "set_limit") {
      setPending({ kind: "limits", perTxNear: intent.perTxNear, dailyNear: intent.dailyNear, thresholdNear: intent.thresholdNear });
      setPhrase("");
      say("drafted new limits, type the phrase to lock them in.", nextSource, nextNote);
      return;
    }
    if ((intent.type === "run_agent" || intent.type === "agent_status" || intent.type === "schedule_send" || intent.type === "price_rule") && !isDemoSession(current)) {
      say(AGENT_DEMO_ONLY, nextSource, nextNote);
      return;
    }
    if (intent.type === "run_agent") {
      if (policyRef.current.killed) {
        say("sending is stopped, so the agent won't run. resume sending first.", nextSource, nextNote);
        return;
      }
      setBusy("Running the agent…");
      const result = await runAgentNow();
      setAgentRules(result.rules);
      setAgentLogs(result.logs);
      if (result.blocked) {
        say("kill switch is on, so the agent's chilling.", nextSource, nextNote);
      } else {
        const last = result.logs.find((log) => log.action === "transfer" || log.action === "quote" || log.action === "blocked") || result.logs[0];
        say(last ? last.reason : `agent ran ${result.ran}, skipped ${result.skipped}.`, nextSource, nextNote, "agent ran, check the log.");
      }
      setTab("wallet");
      return;
    }
    if (intent.type === "agent_status") {
      const agent = await fetchAgentStatus();
      setAgentRules(agent.rules);
      setAgentLogs(agent.logs);
      say(agent.killed
        ? "kill switch is on, agent's stopped."
        : agent.logs[0]
          ? `agent's got ${agent.rules.length} rules. latest: ${agent.logs[0].reason}`
          : `agent's got ${agent.rules.length} rules, nothing yet.`, nextSource, nextNote, `agent's got ${agent.rules.length} rules, log's on screen.`);
      setTab("wallet");
      return;
    }
    if (intent.type === "schedule_send") {
      setPending({ kind: "schedule", recipient: intent.recipient, amountNear: intent.amountNear, cadence: intent.cadence });
      setPhrase("");
      say(`${intent.amountNear} NEAR to ${intent.recipient} ${intent.cadence === "daily" ? "every day" : "every Friday"}? slide to set it.`, nextSource, nextNote);
      setTab("orb");
      return;
    }
    if (intent.type === "price_rule") {
      setPending({ kind: "price", belowUsd: intent.belowUsd, amountNear: intent.amountNear, toSymbol: intent.toSymbol });
      setPhrase("");
      say(`if NEAR dips under $${intent.belowUsd} I'll quote ${intent.amountNear} NEAR to ${intent.toSymbol}. slide to set it.`, nextSource, nextNote);
      setTab("orb");
      return;
    }
    if (intent.type === "send") {
      const amountYocto = parseNear(intent.amountNear);
      if (isDemoSession(current)) {
        const preview = await previewDemoSend({ recipient: intent.recipient, amountNear: intent.amountNear });
        setPending({
          kind: "send",
          recipient: preview.recipient,
          amountNear: preview.amountNear,
          amountYocto: amountYocto.toString(),
          feeNear: preview.feeNear,
          balanceAfterNear: preview.balanceAfterNear,
          check: preview.check,
          confirmToken: preview.confirmToken,
        });
        setPhrase("");
        say(sendLine(preview.check, preview.amountNear, preview.recipient), nextSource, nextNote);
        setTab("orb");
        return;
      }
      const [nextBalance, exists, feeYocto] = await Promise.all([
        readBalance(current.accountId),
        accountExists(intent.recipient),
        estimateTransferFee(false),
      ]);
      if (!nextBalance) throw new Error("Your account is not visible on testnet.");
      setBalance(nextBalance);
      const spentToday = loadSpend(current.accountId);
      setSpent(spentToday);
      const check = assessSend(toPolicy(policyRef.current), {
        recipient: intent.recipient,
        amountYocto,
        feeYocto,
        availableYocto: BigInt(nextBalance.availableYocto),
        spentTodayYocto: spentToday,
        accountExists: exists,
      }, current.accountId);
      const after = BigInt(nextBalance.availableYocto) - amountYocto - feeYocto;
      setPending({
        kind: "send",
        recipient: intent.recipient,
        amountNear: intent.amountNear,
        amountYocto: amountYocto.toString(),
        feeNear: formatNear(feeYocto, 8),
        balanceAfterNear: formatNear(after > 0n ? after : 0n),
        check,
      });
      setPhrase("");
      say(sendLine(check, intent.amountNear, intent.recipient), nextSource, nextNote);
      setTab("orb");
      return;
    }
    say(intent.reason, nextSource, nextNote);
  }

  async function retrySend(recipient: string, amountNear: string) {
    setError(null);
    setBusy("Checking that account…");
    try {
      await applyIntent({ type: "send", recipient, amountNear }, "local-fallback", null);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(null);
    }
  }

  // Adding a recipient always goes through the allow card, which needs the confirm phrase. After it
  // is confirmed the send is drafted again for a fresh slide.
  function allowAndRetry(recipient: string, amountNear: string) {
    setError(null);
    setPending({ kind: "allow", recipient, retryAmountNear: amountNear });
    setPhrase("");
    say(`add ${recipient} to your allowlist? type the phrase, then I'll redraft the send.`, null, null);
  }

  async function confirmPending() {
    const current = sessionRef.current;
    const card = pendingRef.current;
    const stored = policyRef.current;
    if (!current || !card || busy) return;
    const parsed = toPolicy(stored);
    if (card.kind !== "send" && card.kind !== "schedule" && card.kind !== "price" && card.kind !== "scoped_key") {
      if (!phraseMatches(parsed, phrase)) {
        setError("Enter the confirm phrase exactly, then slide to confirm.");
        return;
      }
    } else if (card.kind === "send" && card.check.needsPhrase) {
      if (!phraseMatches(parsed, phrase)) {
        setError("Enter the confirm phrase exactly, then slide to confirm.");
        return;
      }
    }
    setError(null);
    try {
      if (card.kind === "resume") {
        commitPolicy({ ...stored, killed: false }, phrase);
        setPending(null);
        say("sending's back on ✅", null, null);
        return;
      }
      if (card.kind === "scoped_key") {
        setPending(null);
        await addScopedKeyNow();
        return;
      }
      if (card.kind === "swap") {
        if (card.check.blockReason) return;
        await executeSwap(current, card, parsed);
        return;
      }
      if (card.kind === "allow") {
        if (isDemoSession(current)) {
          const view = await updateDemoPolicy({ allow: card.recipient, phrase });
          policyRef.current = view.policy;
          setPolicy(view.policy);
        } else {
          commitPolicy({ ...stored, allowlist: [...new Set([...stored.allowlist, card.recipient])] });
        }
        setPending(null);
        say(`${card.recipient} is on your allowlist now 👍`, null, null);
        if (card.retryAmountNear) await applyIntent({ type: "send", recipient: card.recipient, amountNear: card.retryAmountNear }, "local-fallback", null);
        return;
      }
      if (card.kind === "limits") {
        if (isDemoSession(current)) {
          setPending(null);
          say("demo limits are fixed: 0.3 a send, 2 a day.", null, null);
          return;
        }
        const next = {
          ...stored,
          perTxNear: card.perTxNear ?? stored.perTxNear,
          dailyNear: card.dailyNear ?? stored.dailyNear,
          thresholdNear: card.thresholdNear ?? stored.thresholdNear,
        };
        toPolicy(next);
        commitPolicy(next);
        setPending(null);
        say("limits updated 👌", null, null);
        return;
      }
      if (card.kind === "schedule") {
        setBusy("Saving the agent rule…");
        const json = await addAgentRule({ type: "schedule_send", recipient: card.recipient, amountNear: card.amountNear, cadence: card.cadence });
        setAgentRules(json.rules ?? []);
        setPending(null);
        say(`rule set: ${card.amountNear} NEAR to ${card.recipient} ${card.cadence === "daily" ? "every day" : "every Friday"} 📅`, null, null);
        return;
      }
      if (card.kind === "price") {
        setBusy("Saving the agent rule…");
        const json = await addAgentRule({ type: "price_rule", belowUsd: card.belowUsd, amountNear: card.amountNear, toSymbol: card.toSymbol });
        setAgentRules(json.rules ?? []);
        setPending(null);
        say(`price watch on: under $${card.belowUsd}, I quote ${card.amountNear} NEAR to ${card.toSymbol}.`, null, null);
        return;
      }
      if (card.check.blockReason) return;
      if (isDemoSession(current)) {
        setBusy("Sending from the server-held demo account on testnet…");
        const result = await sendDemoTransfer({ recipient: card.recipient, amountNear: card.amountNear, phrase, confirmToken: card.confirmToken ?? null });
        setReceipt({ hash: result.hash, recipient: result.recipient, amountNear: result.amountNear, feeNear: result.feeNear });
        rememberLocal({
          hash: result.hash,
          signer: current.accountId,
          receiver: result.recipient,
          actions: ["TRANSFER"],
          methods: [],
          depositYocto: card.amountYocto,
          feeYocto: null,
          success: true,
          timestampMs: Date.now(),
          source: "local",
        });
        setPending(null);
        setFlash("done");
        chime();
        haptic([16, 40, 20]);
        window.setTimeout(() => setFlash(null), 8000);
        const nextBalance = await readBalance(current.accountId);
        setBalance(nextBalance);
        say(`done, sent ${result.amountNear} to ${result.recipient} ✌️`, null, null);
        return;
      }
      const earlier = loadPendingSend(current.accountId);
      if (earlier) {
        const settled = await reconcilePendingSend(current.accountId);
        if (settled) say(settled, null, null);
        else if (loadPendingSend(current.accountId)) {
          setError(`Your earlier send (${earlier.hash.slice(0, 8)}…) has not confirmed yet. Check your history before sending again.`);
          return;
        }
      }
      const amountYocto = BigInt(card.amountYocto);
      if (isConnectedSession(current)) {
        setBusy("Approve the send in your wallet…");
        let walletReserved = false;
        try {
          const outcome = await walletTransfer({
            accountId: current.accountId,
            recipient: card.recipient,
            amountYocto,
            policy: parsed,
            spentTodayYocto: loadSpend(current.accountId),
            userConfirmed: true,
            confirmationPhrase: phrase,
            onBeforeBroadcast: () => {
              addSpend(current.accountId, amountYocto);
              walletReserved = true;
              savePendingSend(current.accountId, { hash: "", recipient: card.recipient, amountYocto: card.amountYocto, at: Date.now(), viaRedirect: true });
            },
          });
          if (outcome.redirected) return;
          savePendingSend(current.accountId, null);
          const hash = outcome.hashes[0] ?? "";
          setSpent(loadSpend(current.accountId));
          setReceipt({ hash, recipient: card.recipient, amountNear: card.amountNear, feeNear: "" });
          if (hash) rememberLocal({ hash, signer: current.accountId, receiver: card.recipient, actions: ["TRANSFER"], methods: [], depositYocto: card.amountYocto, feeYocto: null, success: true, timestampMs: Date.now(), source: "local" });
          setPending(null);
          setFlash("done");
          chime();
          window.setTimeout(() => setFlash(null), 8000);
          setBalance(await readBalance(current.accountId));
          say(`done, your wallet sent ${card.amountNear} to ${card.recipient} ✌️`, null, null);
          return;
        } catch (err) {
          if (walletReserved && !(err instanceof SendError && err.outcome === "unknown")) {
            addSpend(current.accountId, -amountYocto);
            savePendingSend(current.accountId, null);
          }
          setSpent(loadSpend(current.accountId));
          throw err;
        }
      }
      setBusy(`Signing in this browser and sending to ${NETWORK_ID}…`);
      let reserved = false;
      let result;
      try {
        result = await executeTransfer({
          accountId: current.accountId,
          fullSecret: current.fullSecret,
          expectedPublicKey: current.fullPublicKey,
          recipient: card.recipient,
          amountYocto,
          policy: parsed,
          spentTodayYocto: loadSpend(current.accountId),
          userConfirmed: true,
          confirmationPhrase: phrase,
          // Count the spend before broadcasting; give it back only if the send certainly did not happen.
          onBeforeBroadcast: () => {
            addSpend(current.accountId, amountYocto);
            reserved = true;
          },
        });
      } catch (err) {
        if (reserved && err instanceof SendError && err.outcome === "unknown" && err.hash) {
          savePendingSend(current.accountId, { hash: err.hash, recipient: card.recipient, amountYocto: card.amountYocto, at: Date.now() });
        } else if (reserved) {
          addSpend(current.accountId, -amountYocto);
        }
        setSpent(loadSpend(current.accountId));
        throw err;
      }
      setSpent(loadSpend(current.accountId));
      setReceipt({ hash: result.hash, recipient: card.recipient, amountNear: card.amountNear, feeNear: formatNear(result.feeYocto, 8) });
      rememberLocal({
        hash: result.hash,
        signer: current.accountId,
        receiver: card.recipient,
        actions: ["TRANSFER"],
        methods: [],
        depositYocto: card.amountYocto,
        feeYocto: result.feeYocto.toString(),
        success: true,
        timestampMs: Date.now(),
        source: "local",
      });
      setPending(null);
      setFlash("done");
      chime();
      haptic([16, 40, 20]);
      window.setTimeout(() => setFlash(null), 8000);
      const nextBalance = await readBalance(current.accountId);
      setBalance(nextBalance);
      say(`done, sent ${card.amountNear} to ${card.recipient} ✌️`, null, null);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(null);
    }
  }

  function stopMic() {
    handsFreeRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    levelStopRef.current?.();
    levelStopRef.current = null;
    levelRef.current = 0;
    setListening(false);
    setInterim("");
  }

  function focusComposer() {
    window.setTimeout(() => composerRef.current?.focus(), 50);
  }

  function startMic() {
    if (recRef.current || transcribing) return;
    if (!voiceInputSupported()) {
      const message = "This browser can't use the microphone. Type a command below, or tap a suggestion.";
      setVoiceHint(message);
      setError(null);
      focusComposer();
      return;
    }
    handsFreeRef.current = true;
    setVoiceHint(null);
    setError(null);
    setInterim("");
    setListening(true);
    void startVoiceInput({
      onLevel: (level) => { levelRef.current = level; },
      onTranscribing: () => {
        setListening(false);
        setTranscribing(true);
        setInterim("");
      },
      onFinal: (text) => {
        setInterim("");
        setTranscribing(false);
        const card = pendingRef.current;
        const spoken = normalizePhrase(text);
        const expected = normalizePhrase(policyRef.current.confirmPhrase);
        if (/^(cancel|never mind|nevermind|no)$/.test(spoken)) {
          setPending(null);
          say("cool, cancelled. nothing signed.", null, null);
          return;
        }
        // The whole utterance must be the phrase; a sentence that merely contains it does not count.
        if (card && expected && spoken === expected) {
          setPhrase(policyRef.current.confirmPhrase);
          say("got the phrase, now slide it.", null, null);
          return;
        }
        if (card?.kind === "send" && card.check.allowlisted && !card.check.needsPhrase && !card.check.blockReason && isAffirmative(text)) {
          void confirmRef.current();
          return;
        }
        void handleRef.current(text);
      },
      onError: (message) => {
        handsFreeRef.current = false;
        recRef.current = null;
        levelRef.current = 0;
        setListening(false);
        setTranscribing(false);
        setInterim("");
        setVoiceHint(message);
        setError(null);
        focusComposer();
      },
      onEnd: () => {
        recRef.current = null;
        handsFreeRef.current = false;
        levelRef.current = 0;
        setListening(false);
        setTranscribing(false);
      },
    }).then((session) => {
      if (!handsFreeRef.current) {
        session?.stop();
        return;
      }
      if (!session) {
        handsFreeRef.current = false;
        setListening(false);
        return;
      }
      recRef.current = session;
    });
  }
  startMicRef.current = startMic;

  function toggleMic() {
    if (transcribing) return;
    if (handsFreeRef.current || recRef.current) stopMic();
    else startMic();
  }

  function pressOrb() {
    pop(600);
    haptic(10);
    if (pendingRef.current?.kind === "send") {
      setPending(null);
      say("cool, cancelled. nothing signed.", null, null);
      return;
    }
    toggleMic();
  }

  async function createRecipient() {
    const current = sessionRef.current;
    const currentVault = vaultRef.current;
    if (!current || !currentVault || currentVault.other || busy) return;
    setBusy("Creating a second funded testnet account…");
    setError(null);
    try {
      const created = await createFundedAccount(suggestTestnetAccountId());
      const other = await encryptSlot({
        accountId: created.accountId,
        publicKey: created.publicKey,
        fullSecret: created.secretKey,
        agentPublicKey: null,
        agentSecret: null,
        passphrase: current.passphrase,
      });
      const nextVault = { ...currentVault, other };
      saveVault(nextVault);
      vaultRef.current = nextVault;
      setVault(nextVault);
      commitPolicy({ ...policyRef.current, allowlist: [...new Set([...policyRef.current.allowlist, created.accountId])] });
      say(`Created ${created.accountId} and added it to your allowlist. You can send NEAR to it, then switch accounts to check the balance.`, null, null);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(null);
    }
  }

  async function switchAccounts() {
    const current = sessionRef.current;
    const currentVault = vaultRef.current;
    if (!current || !currentVault?.other || busy) return;
    setBusy("Switching accounts…");
    setError(null);
    try {
      const otherSession = await sessionFromSlot(currentVault.other, current.passphrase);
      const previous = await slotFromSession(current);
      const nextVault = { ...currentVault, active: currentVault.other, other: previous };
      saveVault(nextVault);
      vaultRef.current = nextVault;
      setVault(nextVault);
      setSession(otherSession);
      setPending(null);
      setReceipt(null);
      setQuote(null);
      say(`Switched to ${otherSession.accountId}.`, null, null);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(null);
    }
  }

  async function proveScopedKey() {
    const current = sessionRef.current;
    if (!current?.agentSecret || !current.agentPublicKey || busy) return;
    setBusy("Signing a scoped call in this browser…");
    setError(null);
    try {
      const result = await executeScopedCall({
        accountId: current.accountId,
        agentSecret: current.agentSecret,
        expectedAgentPublicKey: current.agentPublicKey,
      });
      rememberLocal({
        hash: result.hash,
        signer: current.accountId,
        receiver: SCOPED_CONTRACT_ID,
        actions: ["FUNCTION_CALL"],
        methods: ["storage_balance_of"],
        depositYocto: "0",
        feeYocto: result.feeYocto.toString(),
        success: true,
        timestampMs: Date.now(),
        source: "local",
      });
      setFlash("done");
      say(`Scoped call succeeded. Transaction ${result.hash}. It did not transfer NEAR.`, null, null);
    } catch (err) {
      setError(publicError(err));
    } finally {
      setBusy(null);
    }
  }

  confirmRef.current = confirmPending;
  handleTextRef.current = handleText;

  function shortName(accountId: string): string {
    return /^[0-9a-f]{64}$/.test(accountId) ? "that account" : accountId.replace(/\.(testnet|near)$/, "");
  }

  async function settle() {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }

  async function handsFreeCommand(text: string): Promise<HandsFreeReply> {
    setHeard(text);
    const card = pendingRef.current;
    const armed = voiceConfirmRef.current;
    voiceConfirmRef.current = null;
    if (armed && card?.kind === "send" && armed.card === card && Date.now() < armed.until) {
      // Negatives first: "sure, not now" cancels instead of sending.
      if (isNegative(text)) {
        pushTurn({ role: "user", text });
        setPending(null);
        return { speech: "cool, cancelled." };
      }
      if (isAffirmative(text)) {
        pushTurn({ role: "user", text });
        lastSpeechRef.current = "";
        await confirmRef.current();
        await settle();
        return { speech: lastSpeechRef.current || "hmm, that didn't go through." };
      }
    }
    lastSpeechRef.current = "";
    await handleTextRef.current(text);
    await settle();
    const next = pendingRef.current;
    if (next?.kind === "send" && !next.check.blockReason && !policyRef.current.killed) {
      if (next.check.allowlisted && !next.check.needsPhrase) {
        voiceConfirmRef.current = { card: next, until: Date.now() + VOICE_CONFIRM_MS };
        return { speech: `send ${speakNumber(next.amountNear)} NEAR to ${shortName(next.recipient)}? say yes to confirm, or no.` };
      }
      return { speech: next.check.allowlisted
        ? "that's at or above your extra-confirm amount, so type the phrase and slide on screen."
        : `${shortName(next.recipient)} isn't a trusted contact, so use the slide on screen for this one.` };
    }
    if (next && (next.kind === "schedule" || next.kind === "price")) {
      return { speech: "slide on screen to set that rule." };
    }
    return { speech: lastSpeechRef.current || "done." };
  }

  async function toggleHandsFree() {
    if (convoRef.current?.active) {
      convoRef.current.stop();
      return;
    }
    stopMic();
    unlockSpeech();
    const engine = new HandsFree({
      onState: (state) => setConvo(state),
      onLevel: (level) => { levelRef.current = level; },
      onHeard: (text) => setHeard(text),
      onWake: () => { chime(); haptic(10); },
      onCommand: handsFreeCommand,
      speak: speakAsync,
      onError: (message) => setError(message),
      onEnd: () => {
        stopSpeaking();
        setConvo("off");
        voiceConfirmRef.current = null;
        convoRef.current = null;
      },
    });
    convoRef.current = engine;
    setTab("orb");
    await engine.start({ wakeWord, greeting: wakeWord ? "yo, say hey vibe when you need me." : "yo, I'm listening." });
  }

  useEffect(() => () => convoRef.current?.stop(), []);
  // Any change to the pending card disarms a spoken "yes".
  useEffect(() => {
    if (voiceConfirmRef.current && voiceConfirmRef.current.card !== pending) voiceConfirmRef.current = null;
  }, [pending]);
  handleRef.current = handleText;

  function forgetWallet() {
    clearVault();
    stopSpeaking();
    stopMic();
    setSession(null);
    setVault(null);
    setPending(null);
    setTurns([]);
    setBalance(null);
    setHistory([]);
    setKeys([]);
  }

  if (preview === "orb" || preview === "confirm" || preview === "wallet" || preview === "safety") {
    return <DesignPreview mode={preview} />;
  }
  if (!ready) {
    return (
      <Stage>
        <div className="grid h-full place-items-center">
          <HoloOrb state="idle" levelRef={levelRef} onPress={() => undefined} />
        </div>
      </Stage>
    );
  }
  if (!session || (!vault && !isDemoSession(session) && !isConnectedSession(session))) {
    return <SetupScreen
      onReady={(nextSession, nextVault) => { setSession(nextSession); setVault(nextVault); }}
      onConnected={(nextSession) => {
        sessionRef.current = nextSession;
        setSession(nextSession);
        setVault(null);
      }}
      onDemo={(nextSession, nextPolicy) => {
        sessionRef.current = nextSession;
        setSession(nextSession);
        policyRef.current = nextPolicy;
        setPolicy(nextPolicy);
        setVault(null);
      }}
    />;
  }

  const demo = isDemoSession(session);
  const orb: OrbState = convo !== "off" ? (convo === "wake" ? "wake" : convo)
    : listening ? "listening"
    : transcribing || busy ? "thinking"
    : pending?.kind === "send" && pending.check.blockReason ? "blocked"
    : pending?.kind === "swap" && pending.check.blockReason ? "blocked"
    : pending?.kind === "send" || pending?.kind === "schedule" || pending?.kind === "price" || pending?.kind === "swap" ? "confirming"
    : policy.killed ? "blocked"
    : flash === "done" ? "done"
    : "idle";
  const formatRecipient = (accountId: string) => {
    if (demo && session.demoRecipient && accountId === session.demoRecipient) {
      return /^[0-9a-f]{64}$/i.test(accountId) ? `demo friend (${shortAccount(accountId)})` : accountId;
    }
    return shortAccount(accountId);
  };
  const sendExample = demo && session.demoRecipient
    ? `Send 0.1 NEAR to ${session.demoRecipient}`
    : vault?.other ? `Send 0.2 NEAR to ${vault.other.accountId}` : "Send 0.5 NEAR to bob.testnet";
  const exampleChips: { label: string; text: string }[] = demo && session.demoRecipient ? [
    { label: "Send 0.1 NEAR to demo friend", text: sendExample },
    { label: "What's my balance?", text: "What's my balance?" },
    { label: "Who can I send to?", text: "Who can I send to?" },
    { label: "Every day send 0.1 NEAR", text: `Every day send 0.1 NEAR to ${session.demoRecipient}` },
  ] : [
    { label: sendExample, text: sendExample },
    { label: "Who can I send to?", text: "Who can I send to?" },
    ...EXAMPLES.filter((example) => !example.startsWith("Send")).map((example) => ({ label: example, text: example })),
  ];
  const available = balance ? Number(balance.availableNear) : 0;
  const lastReply = [...turns].reverse().find((turn) => turn.role === "assistant");
  const sendPending = pending?.kind === "send" ? pending : null;
  const swapPending = pending?.kind === "swap" ? pending : null;
  const connected = isConnectedSession(session);
  const phraseOk = sendPending ? (!sendPending.check.needsPhrase || phraseMatches(policy, phrase)) : swapPending ? phraseMatches(policy, phrase) : true;
  const showBalance = !sendPending && !swapPending && flash !== "done";

  return (
    <Stage>
      {flash === "done" ? <BubbleBurst /> : null}
      <header className="topbar">
        <Brand />
        <div className="top-actions">
          <button
            className="icon-btn"
            type="button"
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setSoundMuted(next);
            }}
          >
            {muted ? "×" : "♪"}
          </button>
          <button
            className={convo !== "off" ? "icon-btn hf-on" : "icon-btn"}
            type="button"
            data-testid="handsfree-toggle"
            aria-pressed={convo !== "off"}
            aria-label={convo !== "off" ? "Stop hands-free" : "Start hands-free"}
            onClick={() => void toggleHandsFree()}
          >
            <HeadsetIcon />
          </button>
          <button className="icon-btn" type="button" aria-pressed={listening || transcribing} aria-label={listening ? "Stop recording" : transcribing ? "Transcribing" : "Start recording"} onClick={toggleMic}>
            <MicIcon />
          </button>
        </div>
      </header>
      <div className="pane">
        {tab === "orb" ? (
          <div className="orb-pane">
            {showBalance ? (
              <div className="balance-block">
                <span className="num">{balance ? <CountUp value={available} digits={available >= 1 ? 2 : 4} /> : "…"}</span>
                <span className="unit">NEAR</span>
              </div>
            ) : null}
            <div className="orb-wrap">
              <HoloOrb state={orb} levelRef={levelRef} onPress={pressOrb} />
            </div>
            <div className="caption" aria-live="polite">
              {sendPending ? (
                <>
                  {sendPending.check.blockReason ? "Blocked" : `Send ${sendPending.amountNear} NEAR to ${formatRecipient(sendPending.recipient)}?`}
                  <span className="fee">{sendPending.check.blockReason ?? `fee ${sendPending.feeNear} NEAR`}</span>
                </>
              ) : pending?.kind === "schedule" ? (
                <>Add a {pending.cadence === "daily" ? "daily" : "Friday"} payment of {pending.amountNear} NEAR?</>
              ) : pending?.kind === "price" ? (
                <>Watch NEAR below ${pending.belowUsd} and quote a swap?</>
              ) : flash === "done" && receipt ? (
                <>
                  Done
                  <a className="fee link underline" href={explorerTxUrl(receipt.hash)} target="_blank" rel="noreferrer">View transaction</a>
                </>
              ) : transcribing ? "Transcribing…" : interim ? interim : listening ? "Recording… tap the orb to stop" : lastReply ? lastReply.text : "Just talk to me. Type a command or tap a suggestion."}
            </div>
            {voiceHint ? <p className="banner banner-warn mt-2" role="status">{voiceHint}</p> : null}
            {sendPending?.check.warnings.map((warning) => <p key={warning} className="banner banner-warn mt-2">{warning}</p>)}
            {sendPending?.check.blockReason ? <p className="banner banner-danger mt-2" role="alert">{sendPending.check.blockReason}</p> : null}
            {sendPending && (sendPending.check.similarTo || sendPending.check.allowlisted === false) && !policy.killed ? (
              <div className="mt-2 grid gap-2" data-testid="recipient-fixes">
                {sendPending.check.similarTo ? (
                  <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void retrySend(sendPending.check.similarTo as string, sendPending.amountNear)}>
                    Did you mean {sendPending.check.similarTo}?
                  </button>
                ) : null}
                {sendPending.check.allowlisted === false ? (
                  <button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void allowAndRetry(sendPending.recipient, sendPending.amountNear)}>
                    Add {sendPending.recipient.length > 30 ? `${sendPending.recipient.slice(0, 10)}…` : sendPending.recipient} to allowlist
                  </button>
                ) : null}
              </div>
            ) : null}
            {sendPending?.check.needsPhrase ? (
              <label className="mt-3 grid gap-1 text-sm">
                {demo ? `Type ${policy.confirmPhrase}` : "Type your confirm phrase (set in the Safety tab)"}
                <input className="field" data-testid="confirm-phrase" type={demo ? "text" : "password"} value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
              </label>
            ) : null}
            {policy.killed ? <p className="banner banner-danger mt-2">Sending is stopped. Balance, history, and quotes still work.</p> : null}
            {error ? <p className="banner banner-danger mt-2" role="alert">{error}</p> : null}
            {note ? <p className="mt-2 text-center text-xs text-muted">{source === "near-ai" ? "NEAR AI Cloud" : "Local parser"} · {note}</p> : null}
            {quote ? (
              <section className="glass mt-3 grid gap-2">
                <h2 className="text-lg font-semibold">Quote only</h2>
                <p className="banner banner-warn">{quote.label}</p>
                <p className="text-2xl font-semibold">{quote.amountInFormatted} {quote.originSymbol} → {quote.amountOutFormatted} {quote.destinationSymbol}</p>
                <button className="btn btn-ghost" type="button" onClick={() => setQuote(null)}>Dismiss quote</button>
              </section>
            ) : null}
            {allowCard && !pending ? (
              <AllowlistCard
                policy={policy}
                onPick={(account) => {
                  setAllowCard(false);
                  setDraft(`Send 0.1 NEAR to ${account}`);
                  window.setTimeout(() => composerRef.current?.focus(), 0);
                }}
                onClose={() => setAllowCard(false)}
              />
            ) : null}
            {swapPending ? (
              <section className="glass mt-3 grid gap-2" data-testid="swap-card">
                <h2 className="text-lg font-semibold">Swap on NEAR mainnet</h2>
                <p className="text-2xl font-semibold">{swapPending.quote.amountInFormatted} NEAR → about {swapPending.quote.amountOutFormatted} {swapPending.quote.toSymbol}</p>
                <p className="text-sm">At least {swapPending.quote.minAmountOutFormatted} {swapPending.quote.toSymbol} (1% slippage), delivered to <span className="mono break-all">{session.accountId}</span>. A failed swap refunds the same account.</p>
                <p className="text-sm">Pays: 1Click deposit address <span className="mono break-all">{swapPending.quote.depositAddress}</span>. Quote valid until {new Date(swapPending.quote.deadline).toLocaleTimeString()}.</p>
                <details className="text-xs">
                  <summary>Exactly what will be signed ({swapPending.transactions.length} transaction{swapPending.transactions.length > 1 ? "s" : ""}, {formatNear(BigInt(swapPending.attachedYocto), 6)} NEAR attached incl. {STORAGE_DEPOSIT_NOTE})</summary>
                  <ul className="mono mt-1 grid gap-1 break-all">
                    {swapPending.transactions.flatMap((tx, index) => tx.actions.map((action, inner) => (
                      <li key={`${index}-${inner}`}>{tx.receiverId}: {action.type === "FunctionCall" ? `${action.params.methodName}(${JSON.stringify(action.params.args)}) deposit ${action.params.deposit} yocto` : `transfer ${action.params.deposit} yocto`}</li>
                    )))}
                  </ul>
                </details>
                {swapPending.check.warnings.map((warning) => <p key={warning} className="banner banner-warn">{warning}</p>)}
                {swapPending.check.blockReason ? <p className="banner banner-danger" role="alert">{swapPending.check.blockReason}</p> : (
                  <label className="grid gap-1 text-sm">
                    Type your confirm phrase (set in the Safety tab)
                    <input className="field" data-testid="swap-phrase" type="password" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
                  </label>
                )}
                <button className="btn btn-ghost" type="button" onClick={() => { setPending(null); say("cool, swap cancelled. nothing signed.", null, null); }}>Cancel</button>
              </section>
            ) : null}
            {swapStatusText ? <p className="banner banner-warn mt-2" role="status">{swapStatusText}</p> : null}
            {pending && pending.kind !== "send" && pending.kind !== "schedule" && pending.kind !== "price" && pending.kind !== "swap" ? (
              <ActionCards
                pending={pending}
                phrase={phrase}
                confirmPhrase={policy.confirmPhrase}
                source={source}
                note={note}
                receipt={null}
                quote={null}
                busy={Boolean(busy)}
                showPhrase={demo}
                onPhrase={setPhrase}
                onConfirm={() => void confirmPending()}
                onCancel={() => { setPending(null); say("cool, cancelled. nothing signed.", null, null); }}
                onDismissReceipt={() => setReceipt(null)}
                onDismissQuote={() => setQuote(null)}
              />
            ) : null}
            {pending ? null : (
              <div className="chips" data-testid="command-chips">
                {exampleChips.map((example) => (
                  <button key={example.label} type="button" onClick={() => void handleText(example.text)}>{example.label}</button>
                ))}
              </div>
            )}
            <form className="composer" onSubmit={(event) => { event.preventDefault(); void handleText(draft); }}>
              <input
                ref={composerRef}
                className="field"
                data-testid="command-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type or tap a suggestion"
                aria-label="Type a command"
              />
              <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>Ask</button>
            </form>
            {convo === "off" ? (
              <button className="hf-wake-toggle" type="button" data-testid="wake-toggle" aria-pressed={wakeWord} onClick={() => setWakeWord((on) => !on)}>
                Hands-free wake word “hey vibe”: <strong>{wakeWord ? "on" : "off"}</strong> · tap 🎧 to start
              </button>
            ) : null}
          </div>
        ) : (
          <WalletTab
            accountId={session.accountId}
            demo={demo}
            agentSlot={<>{demo ? (
              <AgentPanel
                rules={agentRules}
                logs={agentLogs}
                killed={policy.killed}
                busy={Boolean(busy)}
                onRun={() => void handleText("Run the agent")}
                onDelete={(id) => {
                  void addAgentRule({ deleteId: id }).then((json) => {
                    setAgentRules(json.rules ?? []);
                    if (json.logs) setAgentLogs(json.logs);
                  }).catch((err) => setError(publicError(err)));
                }}
              />
            ) : (
              <section className="glass grid gap-2" data-testid="agent-demo-only">
                <h2 className="text-lg font-semibold">Autonomous agent</h2>
                <p className="text-sm text-muted">Scheduled payments and price rules run on the shared demo account, with the demo&apos;s limits. They are not available for a personal wallet in this build.</p>
              </section>
            )}<OnChainLimitsCard refreshKey={limitsRefresh} /></>}
            availableNear={available}
            nearPrice={nearPrice}
            hidden={hidden}
            onToggleHidden={() => setHidden((value) => !value)}
            history={history}
            quote={quote}
            onSend={() => { setTab("orb"); setSheet(null); startMic(); }}
            onReceive={() => setSheet("receive")}
            onSwap={() => setSheet("swap")}
            policy={policy}
            spentTodayNear={formatNear(spent)}
            keys={keys}
            hasAgentKey={Boolean(session.agentSecret)}
            custody={demo ? "demo" : connected ? "wallet" : "browser"}
            busy={Boolean(busy)}
            onPolicy={(next) => commitPolicy(next)}
            onAllow={(id) => { setPending({ kind: "allow", recipient: id }); setPhrase(""); setTab("orb"); }}
            onRemoveAllow={(id) => {
              if (demo) {
                void updateDemoPolicy({ remove: id }).then((view) => { policyRef.current = view.policy; setPolicy(view.policy); }).catch((err) => setError(publicError(err)));
              } else {
                commitPolicy({ ...policy, allowlist: policy.allowlist.filter((item) => item !== id) });
              }
            }}
            onKill={() => { commitPolicy({ ...policy, killed: true }); say("kill switch on 🛑", null, null); }}
            onResume={() => { setPending({ kind: "resume" }); setPhrase(""); setTab("orb"); }}
            onRefreshKeys={() => void listKeys(session.accountId).then(setKeys).catch((err) => setError(publicError(err)))}
            onScopedCall={() => void proveScopedKey()}
            onAddScopedKey={() => { setPending({ kind: "scoped_key" }); setTab("orb"); }}
            hasScopedKeyOnChain={keys.some(isScopedKey) || Boolean(session.agentPublicKey)}
            globalKilled={globalKilled}
            onForget={forgetWallet}
            onLock={() => {
              stopMic();
              stopSpeaking();
              if (connected) void disconnectWallet();
              setSession(null);
            }}
            connectedWallet={connected ? session.walletId ?? "wallet" : null}
            otherAccount={vault?.other?.accountId ?? null}
            onCreateRecipient={() => void createRecipient()}
            onSwitch={() => void switchAccounts()}
          />
        )}
        {sheet === "receive" ? (
          <section className="glass mt-3 grid gap-2">
            <h2 className="text-lg font-semibold">Receive</h2>
            <p className="mono">{session.accountId}</p>
            <button className="btn btn-primary" type="button" onClick={() => void navigator.clipboard.writeText(session.accountId)}>Copy account id</button>
            <a className="underline" href={explorerAccountUrl(session.accountId)} target="_blank" rel="noreferrer">View on {NETWORK_ID} explorer</a>
            <button className="btn btn-ghost" type="button" onClick={() => setSheet(null)}>Close</button>
          </section>
        ) : null}
        {sheet === "swap" ? (
          <form className="glass mt-3 grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            setSheet(null);
            setTab("orb");
            setBusy("Getting the quote…");
            void applyIntent({ type: "quote_swap", amountNear: swapAmount.trim(), toSymbol: swapSymbol }, "local-fallback", null)
              .catch((err) => setError(publicError(err)))
              .finally(() => setBusy(null));
          }}>
            <h2 className="text-lg font-semibold">{IS_MAINNET && !demo ? "Swap (NEAR Intents, mainnet)" : "Swap quote"}</h2>
            <input className="field" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} aria-label="Amount in NEAR" />
            <select className="field" value={swapSymbol} onChange={(event) => setSwapSymbol(event.target.value as "USDT" | "USDC" | "ETH")}>
              <option>USDT</option>
              <option>USDC</option>
              <option>ETH</option>
            </select>
            <button className="btn btn-primary" type="submit">Get quote</button>
            <button className="btn btn-ghost" type="button" onClick={() => setSheet(null)}>Close</button>
          </form>
        ) : null}
      </div>
      {(sendPending && !sendPending.check.blockReason) || (swapPending && !swapPending.check.blockReason) || pending?.kind === "schedule" || pending?.kind === "price" ? (
        <div className="slider-shell" data-testid="slide-confirm">
          <SlideConfirm
            disabled={((Boolean(sendPending) || Boolean(swapPending)) && !phraseOk) || Boolean(busy)}
            hint={(sendPending || swapPending) && !phraseOk ? (demo ? `Type "${policy.confirmPhrase}" to unlock` : "Type your confirm phrase to unlock") : busy ? "Working…" : undefined}
            onConfirm={() => void confirmPending()}
          />
        </div>
      ) : null}
      {convo !== "off" ? (
        <div className="hf-bar" data-testid="handsfree-bar" role="status" aria-live="polite">
          <div className="hf-status">
            <span className={`hf-dot hf-${convo}`} aria-hidden />
            <div className="min-w-0">
              <strong>{convo === "wake" ? "Say “hey vibe”" : convo === "listening" ? "Listening…" : convo === "thinking" ? "Thinking…" : "Speaking…"}</strong>
              <span className="block truncate text-xs text-muted">{heard ? `heard: “${heard}”` : "Hands-free · screen stays on"}</span>
            </div>
          </div>
          <button className="hf-stop" type="button" data-testid="handsfree-stop" onClick={() => convoRef.current?.stop()}>Stop</button>
        </div>
      ) : null}
      <TabBar tab={tab} onChange={setTab} />
    </Stage>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="6" y="2" width="6" height="9" rx="3" fill="none" stroke="#2c2a2e" strokeWidth="1.5" />
      <path d="M4 8.5a5 5 0 0 0 10 0M9 13.5V16" fill="none" stroke="#2c2a2e" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="#2c2a2e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </svg>
  );
}
