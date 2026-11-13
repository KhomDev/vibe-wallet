"use client";

import Link from "next/link";
import { APK_PATH, APP_NAME, SITE_URL } from "@/lib/site";

const features = [
  {
    title: "Talk to the orb",
    body: "Put your phone on the table and speak. Ask for your balance, send NEAR, or quote a swap. Type if you would rather not talk.",
    img: "/marketing/orb.png",
    alt: "Vibe Wallet orb screen, ready to listen",
  },
  {
    title: "Slide to confirm",
    body: "Nothing leaves your phone until you slide to confirm. The private key stays in the browser. The slider only appears when a payment needs your OK.",
    img: "/marketing/confirm.png",
    alt: "Slide to confirm a NEAR transfer",
  },
  {
    title: "NEAR Intents",
    body: "Ask to swap NEAR to USDT, USDC, or ETH and get a live quote. Quotes stay quote-only on testnet, so nothing is signed by accident.",
    img: "/marketing/wallet.png",
    alt: "Wallet tab with send, receive, and swap",
  },
  {
    title: "Limits and a kill switch",
    body: "Daily and per-transaction limits, an allowlist, and a red Stop all sending switch. When a command breaks a rule, the orb goes into a blocked state and says why out loud. The kill switch also stops the agent.",
    img: "/marketing/safety.png",
    alt: "Kill switch on, with a blocked send and safety controls",
  },
];

export function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <strong>{APP_NAME}</strong>
        </div>
        <nav>
          <a href="#features">Features</a>
          <a href="#install">Install</a>
          <Link href="/?app=1">Open web app on desktop</Link>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker">Personal voice wallet · NEAR testnet</p>
          <h1>{APP_NAME}</h1>
          <p className="lp-lead">
            Talk to the orb, then slide to confirm a real NEAR testnet payment. Limits, an allowlist, and a kill switch stay in your hands. Try the shared demo — no wallet setup needed.
          </p>
          <div className="lp-actions">
            <Link className="lp-btn lp-btn-primary" href="/?app=1&demo=1">
              Try a demo account
            </Link>
            <a className="lp-btn lp-btn-ghost" href={APK_PATH}>
              Download APK
            </a>
          </div>
          <div className="lp-qr-row">
            <img className="lp-qr" src="/qr/vibe-wallet.png" alt={`QR code that opens ${SITE_URL}`} width={148} height={148} />
            <div>
              <p className="lp-qr-label">Scan to open on your phone</p>
              <p className="lp-qr-url">{SITE_URL.replace("https://", "")}</p>
              <p className="lp-note">Android: download the APK. iPhone: add it to your Home Screen in Safari or Chrome.</p>
            </div>
          </div>
        </div>
        <Link className="lp-hero-art" href="/?app=1&demo=1" aria-label="Open the shared demo account">
          <figure className="lp-phone lp-phone-main">
            <img src="/marketing/orb.png" alt="Vibe Wallet on a phone, showing the talking orb" />
          </figure>
          <figure className="lp-phone lp-phone-side">
            <img src="/marketing/confirm.png" alt="Slide to confirm a transfer in Vibe Wallet" />
          </figure>
        </Link>
      </section>

      <section className="lp-features" id="features">
        <h2>Why it feels good in your hand</h2>
        <div className="lp-feature-grid">
          {features.map((feature) => (
            <article className="lp-card" key={feature.title}>
              <div className="lp-card-shot">
                <img src={feature.img} alt={feature.alt} />
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-install" id="install">
        <h2>Install Vibe Wallet</h2>
        <div className="lp-install-grid">
          <article className="lp-guide">
            <h3>Android · Download the APK</h3>
            <ol>
              <li>Tap <a href={APK_PATH}>Download APK</a> and wait for the file to finish.</li>
              <li>Open the downloaded file. If Android blocks it, go to Settings and allow this browser to install unknown apps.</li>
              <li>On some phones that is Settings → Apps → Special app access → Install unknown apps, then turn on your browser.</li>
              <li>Tap Install, then Open. Vibe Wallet launches in its own window.</li>
              <li>Testnet NEAR has no monetary value. Only use this build with a testnet account.</li>
            </ol>
            <a className="lp-btn lp-btn-primary" href={APK_PATH}>Download APK</a>
          </article>
          <article className="lp-guide">
            <h3>iPhone · Add to Home Screen</h3>
            <p>There is no App Store listing. Add Vibe Wallet from Safari or from Chrome (iOS 16.4 or later). The orb icon opens in standalone mode, like an app.</p>
            <h4>Safari</h4>
            <ol>
              <li>Open this site in Safari.</li>
              <li>Tap the Share button at the bottom of the screen.</li>
              <li>Scroll and tap Add to Home Screen.</li>
              <li>Leave the name as Vibe Wallet and tap Add.</li>
            </ol>
            <h4>Chrome</h4>
            <ol>
              <li>Open this site in Chrome on iOS 16.4 or later.</li>
              <li>Tap the Share icon in the address bar.</li>
              <li>Tap Add to Home Screen.</li>
              <li>Leave the name as Vibe Wallet and tap Add.</li>
            </ol>
          </article>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-brand">
          <img src="/icons/icon-192.png" alt="" width={28} height={28} />
          <strong>{APP_NAME}</strong>
        </div>
        <p>Personal voice wallet for NEAR testnet. You confirm every send.</p>
        <Link href="/?app=1">Open web app on desktop</Link>
      </footer>
    </div>
  );
}
