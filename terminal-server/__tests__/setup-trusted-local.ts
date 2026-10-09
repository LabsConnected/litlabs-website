/**
 * Test-process setup: simulates a developer machine that has explicitly opted
 * in to local host execution and is bound to loopback, so unit tests of the
 * PTY manager and routes exercise the permitted path. Every test that checks a
 * refusal sets its own environment (NODE_ENV=production, hosted markers, a
 * missing opt-in, a non-loopback bind), and isolation-policy.test.ts passes
 * explicit env objects, so this default cannot mask a regression there.
 */
process.env.LITT_ALLOW_LOCAL_HOST_EXEC = "1";
process.env.LITT_RESOLVED_BIND_HOST = "127.0.0.1";
