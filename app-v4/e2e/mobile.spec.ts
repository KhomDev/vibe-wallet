import { expect, test, type Page } from "@playwright/test";

const RECIPIENT = process.env.E2E_DEMO_RECIPIENT || "vibe-friend-uxwhdb.testnet";
const SHOTS = process.env.SHOTS_DIR;

async function openDemo(page: Page) {
  await page.goto("/?app=1");
  const demo = page.getByRole("button", { name: "Try a demo account" });
  const input = page.getByTestId("command-input");
  await expect(demo.or(input).first()).toBeVisible({ timeout: 30_000 });
  // The demo button is server-rendered, so a click before hydration does nothing; retry until the app opens.
  await expect(async () => {
    if (await demo.isVisible().catch(() => false)) await demo.click();
    await expect(input).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  const ok = page.getByRole("button", { name: "OK", exact: true });
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

async function ask(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByRole("button", { name: "Ask" }).click();
}

test("allowlist card, tap-to-send prefill, unlocked slider for a trusted recipient", async ({ page }, info) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Who can I send to?" }).click();
  const card = page.getByTestId("allowlist-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("NEAR per send");
  await expect(card).toContainText(RECIPIENT.slice(0, 8));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-allowlist-card.png` });
  await card.getByRole("button", { name: `Send 0.1 NEAR to ${RECIPIENT}` }).click();
  await expect(page.getByTestId("command-input")).toHaveValue(`Send 0.1 NEAR to ${RECIPIENT}`);
  await page.getByRole("button", { name: "Ask" }).click();
  const slider = page.getByRole("slider", { name: "Slide to confirm" });
  await expect(slider).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("confirm-phrase")).toHaveCount(0);
  await expect(slider).not.toHaveAttribute("aria-disabled", "true");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-slide-unlocked.png` });
  await page.getByTestId("holo-orb").click(); // cancel, nothing signed
  await expect(page.locator(".caption")).toContainText(/cancelled/i);
});

test("typo and non-allowlisted recipients get did-you-mean and add-to-allowlist fixes", async ({ page }, info) => {
  await openDemo(page);
  const typo = `${RECIPIENT.slice(0, -1)}${RECIPIENT.endsWith("a") ? "b" : "a"}`;
  await ask(page, `send 0.01 NEAR to ${typo}`);
  const fixes = page.getByTestId("recipient-fixes");
  await expect(fixes).toBeVisible({ timeout: 30_000 });
  await expect(fixes.getByRole("button", { name: `Did you mean ${RECIPIENT}?` })).toBeVisible();
  await expect(fixes.getByRole("button", { name: /^Add .* to allowlist$/ })).toBeVisible();
  // No slider: allowlist-only blocks the typo, so nothing can be signed by accident.
  await expect(page.getByRole("slider", { name: "Slide to confirm" })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-did-you-mean.png` });
});

test("a real drag on the slider sends to a trusted recipient", async ({ page }, info) => {
  await openDemo(page);
  await ask(page, `send 0.01 NEAR to ${RECIPIENT}`);
  const knob = page.getByRole("slider", { name: "Slide to confirm" });
  await expect(knob).toBeVisible({ timeout: 60_000 });
  const track = page.getByTestId("slide-confirm");
  const k = await knob.boundingBox();
  const t = await track.boundingBox();
  if (!k || !t) throw new Error("slider not laid out");
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(k.x + k.width / 2 + ((t.width - k.width) * i) / 12, k.y + k.height / 2);
  }
  await page.mouse.up();
  await expect(page.getByRole("link", { name: /View transaction/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".caption")).toContainText(/done|sent/i);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-sent.png` });
});

test("hands-free full loop: wake word, command, spoken yes, real send, Stop", async ({ page }, info) => {
  test.skip(info.project.name !== "android-chromium", "Fake microphone audio needs Chromium's --use-file-for-fake-audio-capture.");
  test.setTimeout(180_000);
  // The fake mic plays a looping speech clip, so the on-device VAD really fires.
  // Whisper's answers are scripted so the conversation is deterministic.
  const script = ["Hey vibe.", `Send 0.01 NEAR to ${RECIPIENT}`, "Yes, do it."];
  const heard: string[] = [];
  await page.route("**/api/transcribe", async (route) => {
    const text = heard.length < script.length ? script[heard.length] : "";
    heard.push(text);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, source: "near-ai-whisper" }) });
  });
  await openDemo(page);
  await page.getByTestId("handsfree-toggle").click();
  const bar = page.getByTestId("handsfree-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Say .hey vibe.|Listening|Speaking/, { timeout: 30_000 });
  await expect(page.getByRole("slider", { name: "Slide to confirm" })).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-handsfree-confirm.png` });
  await expect(page.getByRole("link", { name: /View transaction/i })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".caption")).toContainText(/done/i);
  await expect(page.getByTestId("handsfree-bar")).toContainText("Yes, do it.");
  expect(heard.slice(0, 3)).toEqual(script);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-handsfree-sent.png` });
  await page.getByTestId("handsfree-stop").click();
  await expect(bar).toHaveCount(0);
});

test("hands-free: the real fake-mic clip goes through Whisper and gets a spoken answer", async ({ page }, info) => {
  test.skip(info.project.name !== "android-chromium", "Fake microphone audio needs Chromium.");
  test.setTimeout(120_000);
  await openDemo(page);
  await page.getByRole("button", { name: /wake word/ }).click(); // wake word off: listen continuously
  await page.getByTestId("handsfree-toggle").click();
  await expect(page.locator(".caption")).toContainText(/you've got|balance/i, { timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-handsfree-balance.png` });
  await page.getByTestId("handsfree-stop").click();
  await expect(page.getByTestId("handsfree-bar")).toHaveCount(0);
});
