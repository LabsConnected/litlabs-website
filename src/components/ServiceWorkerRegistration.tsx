"use client";

import { useEffect } from "react";

/**
 * Cleanup-only service worker unregistration.
 *
 * The previous implementation registered /sw.js on every page load and
 * force-reloaded when a new SW was detected. Combined with sw.js being a
 * self-destructing SW (it unregisters itself on activate + calls
 * clients.claim()), this created an infinite reload loop that froze every
 * page — including /sign-in.
 *
 * This component now ONLY unregisters any existing service workers and clears
 * their caches. It never registers a new SW. The static /sw.js file remains
 * in public/ as a self-destructing fallback for browsers that already have it
 * registered, so they will fetch it, self-destruct, and be unregistered.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const unregisterAll = async () => {
      try {
        const registrations =
          await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((reg) => reg.unregister()),
        );

        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        /* ignore — best-effort cleanup */
      }
    };

    unregisterAll();
  }, []);

  return null;
}
