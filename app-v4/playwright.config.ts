import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "https://vibe-wallet-testnet.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [
    { name: "chromium", testMatch: /production\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "android-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--use-file-for-fake-audio-capture=tests/fixtures/handsfree-balance.wav",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    // WebKit needs system libraries that this box cannot install (apt mirror down); set E2E_WEBKIT=1 where WebKit works.
    { name: "iphone", testMatch: /mobile\.spec\.ts/, use: { ...devices["iPhone 13"], browserName: process.env.E2E_WEBKIT ? "webkit" : "chromium", permissions: [], launchOptions: {} } },
  ],
});
