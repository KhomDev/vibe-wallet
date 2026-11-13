"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const arm = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const ping = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      };
      ping();
      worker.addEventListener("statechange", ping);
    };

    const run = () => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        arm(reg.waiting || reg.installing);
        reg.addEventListener("updatefound", () => arm(reg.installing));
      }).catch(() => {});
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);
  return null;
}
