import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.vibe.wallet",
  appName: "Vibe Wallet",
  webDir: "cap-www",
  server: {
    url: "https://vibe-wallet-flame.vercel.app/?app=1",
    androidScheme: "https",
    cleartext: false,
    // The WebView may only show the app's own origin; any other link opens outside the app.
    allowNavigation: ["vibe-wallet-flame.vercel.app"],
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
