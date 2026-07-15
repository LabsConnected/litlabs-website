"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const registerSW = async () => {
      try {
        // Hard reset: unregister any old service workers and clear caches
        // so the new layout/navigation is never hidden behind a stale SW.
        const registrations = await navigator.serviceWorker.getRegistrations();
        const hadRegistrations = registrations.length > 0;
        await Promise.all(registrations.map((r) => r.unregister()));
        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names.map((n) => caches.delete(n)));
        }
        // If an old registration was removed, reload once to fetch the latest
        // HTML from the network instead of the stale SW cache.
        if (hadRegistrations) {
          window.location.reload();
          return;
        }

        const registration = await navigator.serviceWorker.register(
          "/sw.js?v=2",
          {
            scope: "/",
          },
        );

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
