import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  environment: process.env.NODE_ENV,

  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || "development",

  beforeSend(event) {
    if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
      return null;
    }
    return event;
  },

  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Network request failed",
    "Failed to fetch",
    "Load failed",
    "Navigation cancelled",
    "User navigation",
  ],

  denyUrls: [
    /chrome-extension:\/\//,
    /extensions\//i,
    /^chrome:\/\//i,
  ],
});
