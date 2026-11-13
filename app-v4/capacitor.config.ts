import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.vibe.wallet",
  appName: "Vibe Wallet",
  webDir: "cap-www",
  server: {
    url: "https://vibe-wallet-flame.vercel.app/?app=1",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
