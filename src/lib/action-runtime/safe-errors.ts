export type SafeFailure = {
  code: string;
  message: string;
};

export function mapBrowserFailure(error: unknown, fallbackCode = "BROWSER_ACTION_FAILED"): SafeFailure {
  const text = error instanceof Error ? error.message.toLowerCase() : "";
  if (text.includes("browserbase_api_key") || text.includes("not configured")) {
    return {
      code: "BROWSER_SESSION_UNAVAILABLE",
      message: "LiTT couldn't start the browser session because browser access is not configured.",
    };
  }
  if (text.includes("human control") || text.includes("take control")) {
    return {
      code: "BROWSER_USER_REQUIRED",
      message: "LiTT needs you to take control of the browser before it can continue.",
    };
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return {
      code: "BROWSER_ACTION_TIMEOUT",
      message: "The browser took too long to respond.",
    };
  }
  return {
    code: fallbackCode,
    message: "LiTT couldn't complete the browser action.",
  };
}
