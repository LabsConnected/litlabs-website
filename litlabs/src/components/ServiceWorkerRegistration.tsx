"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // If a new service worker is waiting, reload the page so it activates
        // immediately. This guarantees returning visitors see the latest landing page.
        const reloadIfWaiting = () => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
            // Give the SW a moment to activate, then reload once.
            setTimeout(() => {
              window.location.reload();
            }, 100);
          }
        };

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New content available — force activation and reload.
              newWorker.postMessage({ type: "SKIP_WAITING" });
              setTimeout(() => {
                window.location.reload();
              }, 100);
            }
          });
        });

        // Check on initial load too.
        reloadIfWaiting();
      } catch {
        /* SW registration failed silently */
      }
    };

    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
      return () => window.removeEventListener("load", registerSW);
    }
  }, []);

  return null;
}
