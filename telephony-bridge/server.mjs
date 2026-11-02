import { createServer } from "http";

// Phase 2A: prepared scaffolding only. This service is NOT deployed to
// Railway and has NO Twilio or Inworld wiring. It exists so the service's
// shape (health check, port handling) is reviewable before any real
// provisioning happens. Do not add Twilio credentials or call-handling
// logic here without separate, explicit authorization — see
// docs/superpowers/plans/2026-10-22-dex-autonomous-calling.md.

const PORT = process.env.PORT ?? 4010;

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        service: "litlabs-telephony-bridge",
        status: "ok",
        phase: "2A-staging-prep",
        twilioWired: false,
        inworldWired: false,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`[telephony-bridge] Phase 2A prep server listening on :${PORT} (no telephony logic wired)`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
