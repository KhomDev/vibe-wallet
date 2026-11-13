import { Suspense } from "react";
import { HomeGate } from "@/components/HomeGate";

export default function Home() {
  return (
    <Suspense fallback={<div className="stage" aria-busy="true" aria-label="Vibe Wallet" />}>
      <HomeGate />
    </Suspense>
  );
}
