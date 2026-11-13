import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RECIPIENT = "a94ddd8e89eddfaa4a5c6ed25e809cd73265256e391e04c5bc59b6d83bfa055a";
const fixture = readFileSync(join(process.cwd(), "tests/fixtures/whats-my-balance.webm"));

async function installFakeMicrophone(page: Page) {
  const bytes = Array.from(fixture);
  await page.addInitScript((payload: number[]) => {
    const blobFromFixture = () => new Blob([new Uint8Array(payload)], { type: "audio/webm" });
    const OriginalRecorder = window.MediaRecorder;
    class FakeRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType || "audio/webm";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.(new BlobEvent("dataavailable", { data: blobFromFixture() }));
        this.onstop?.();
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }
    Object.defineProperty(FakeRecorder, "isTypeSupported", { value: () => true });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, writable: true, value: FakeRecorder });
    void OriginalRecorder;
  }, bytes);
}

async function openDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vibe Wallet", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL(/app=1/);
  await expect(page.getByTestId("holo-orb")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("command-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("NEAR", { exact: true })).toBeVisible();
}

test("landing page, CTA opens the app, and the APK download returns 200", async ({ page, request, baseURL }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vibe Wallet", exact: true })).toBeVisible();
  await expect(page.getByAltText(/QR code/i)).toBeVisible();
  const apk = page.getByRole("link", { name: "Download APK" }).first();
  await expect(apk).toBeVisible();
  await expect(apk).toHaveAttribute("href", /\/download\/vibe-wallet\.apk$/);

  const response = await request.get(`${baseURL}/download/vibe-wallet.apk`);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.subarray(0, 2).toString()).toBe("PK");
  expect(body.byteLength).toBeGreaterThan(1_000_000);

  await page.getByRole("link", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL(/app=1/);
  await expect(page.getByTestId("holo-orb")).toBeVisible({ timeout: 30_000 });
});

test("typed commands, voice via fake audio, slide-to-confirm send, and the Wallet tab", async ({ page }) => {
  await installFakeMicrophone(page);
  await openDemo(page);

  await page.getByTestId("command-input").fill("What's my balance?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".caption")).toContainText(/you've got|you have|balance/i, { timeout: 30_000 });

  await page.getByTestId("holo-orb").click();
  await expect(page.locator(".caption")).toContainText(/Recording/i, { timeout: 10_000 });
  await page.getByTestId("holo-orb").click();
  await expect(page.locator(".caption")).toContainText(/Transcribing|Recording|you've got|you have|balance/i, { timeout: 30_000 });

  await page.getByTestId("command-input").fill(`send 0.1 NEAR to ${RECIPIENT}`);
  await page.getByRole("button", { name: "Ask" }).click();
  const slider = page.getByRole("slider", { name: "Slide to confirm" });
  await expect(slider).toBeVisible({ timeout: 30_000 });
  // The demo friend is allowlisted and 0.1 NEAR is under the cap, so no typed phrase is needed.
  await expect(page.getByTestId("confirm-phrase")).toHaveCount(0);
  await slider.focus();
  await slider.press("Enter");
  await expect(page.getByRole("link", { name: /View transaction/i })).toBeVisible({ timeout: 60_000 });
  const href = await page.getByRole("link", { name: /View transaction/i }).getAttribute("href");
  expect(href).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);

  await page.getByRole("button", { name: "Wallet" }).click();
  await expect(page.getByRole("button", { name: "Wallet" })).toHaveClass(/on/);
  await expect(page.getByText("Shared demo account · testnet only · key not in this browser")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Receive" })).toBeVisible();
});
