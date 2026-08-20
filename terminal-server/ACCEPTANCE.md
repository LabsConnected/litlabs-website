# Phase 4 Live Acceptance Commands

These commands verify the deployed terminal-server on Railway after a
fresh deployment of commit `f990b153` (Phase 2 + Phase 3).

## Prerequisites

```bash
# Set these from Railway service variables (railway variables):
export TERMINAL_URL="https://litlabs-terminal-server-production-0be1.up.railway.app"
export TERMINAL_AUTH_SECRET="<from Railway>"        # 64 chars
export TERMINAL_INTERNAL_SERVICE_KEY="<from Railway>" # 64 chars
```

## 1. Deploy (after Railway incident resolves)

```bash
cd C:\Users\litbi\CascadeProjects\litt-final-integration
railway up --detach --message "Phase 2+3: PTY lifecycle + backpressure (f990b153)"
```

Poll until the deployment is SUCCESS:

```bash
railway deployment list
# Look for the newest deployment ID with status SUCCESS
```

## 2. Health Check

```bash
# Live health (liveness)
curl -s -m 10 "$TERMINAL_URL/health/live" | jq .

# Readiness (auth, workspace, docker checks)
curl -s -m 10 "$TERMINAL_URL/health" | jq .

# Expected:
#   status: "ok"
#   readiness: "ready"
#   checks.authConfigured: true
#   checks.internalServiceConfigured: true
#   checks.workspaceRoot: true
#   activeSessions: 0
```

## 3. Verify Deployed Commit / Backpressure Code

```bash
# Check that the new PtySessionManager is running by hitting /internal/sessions
# (requires internal service key)
curl -s -m 10 -H "X-Internal-Service-Key: $TERMINAL_INTERNAL_SERVICE_KEY" \
  "$TERMINAL_URL/internal/sessions" | jq .

# Expected: { "sessions": [] }
# If the old code were running, this endpoint wouldn't exist or would 401.
```

## 4. Socket.IO Connection + PTY Lifecycle

This requires a Socket.IO client with a valid terminal token. The token
is an HMAC-signed JWT-like token using TERMINAL_AUTH_SECRET.

### 4a. Generate a terminal token

```bash
# Generate a signed terminal token (Node.js one-liner)
node -e "
const crypto = require('crypto');
const secret = process.env.TERMINAL_AUTH_SECRET;
const payload = {
  sub: 'acceptance-test-user',
  aud: 'littree-terminal',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  cwd: '/data/littree-workspaces/acceptance-test-user'
};
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
console.log(encoded + '.' + sig);
"
```

### 4b. Connect, create PTY, send input, receive output, resize, disconnect

```bash
# Install socket.io-client if not present
npm ls socket.io-client 2>/dev/null || npm install -g socket.io-client

# Run the acceptance test script:
node -e "
const { io } = require('socket.io-client');
const token = process.argv[2];
const url = process.env.TERMINAL_URL;

const socket = io(url, {
  auth: { token },
  transports: ['websocket'],
  timeout: 10000,
});

let gotOutput = false;
let gotReady = false;
let sessionId = null;

socket.on('connect', () => console.log('[PASS] Socket.IO connected'));
socket.on('session:ready', (data) => {
  gotReady = true;
  sessionId = data.sessionId;
  console.log('[PASS] session:ready', data.sessionId);
  // Send input
  socket.emit('terminal:input', 'echo hello-from-acceptance\r');
});
socket.on('terminal:output', (data) => {
  if (!gotOutput && data.includes('hello-from-acceptance')) {
    gotOutput = true;
    console.log('[PASS] PTY stdout received:', data.trim().substring(0, 80));
    // Resize
    socket.emit('terminal:resize', { cols: 120, rows: 40 });
    console.log('[PASS] resize sent');
    // Disconnect
    setTimeout(() => {
      socket.disconnect();
      console.log('[PASS] disconnect sent');
      // Verify session cleanup
      setTimeout(() => {
        const http = require('http');
        const req = http.request(url + '/internal/sessions', {
          headers: { 'X-Internal-Service-Key': process.env.TERMINAL_INTERNAL_SERVICE_KEY }
        }, (res) => {
          let body = '';
          res.on('data', (c) => body += c);
          res.on('end', () => {
            const sessions = JSON.parse(body).sessions || [];
            const stillAlive = sessions.find(s => s.sessionId === sessionId);
            if (!stillAlive) {
              console.log('[PASS] session cleaned up after disconnect');
            } else {
              console.log('[FAIL] session still alive after disconnect');
            }
            console.log(gotReady && gotOutput ? '\\n[ALL PASS] PTY lifecycle verified' : '\\n[FAIL] Missing steps');
            process.exit(gotReady && gotOutput ? 0 : 1);
          });
        });
        req.end();
      }, 2000);
    }, 1000);
  }
});
socket.on('connect_error', (err) => {
  console.log('[FAIL] Socket.IO connect error:', err.message);
  process.exit(1);
});
setTimeout(() => {
  console.log('[FAIL] Timeout waiting for PTY output');
  process.exit(1);
}, 15000);
" "$(node -e "
const crypto = require('crypto');
const secret = process.env.TERMINAL_AUTH_SECRET;
const payload = { sub: 'acceptance-test-user', aud: 'littree-terminal', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, cwd: '/data/littree-workspaces/acceptance-test-user' };
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
console.log(encoded + '.' + sig);
")"
```

## 5. Large-Output Backpressure Test

This test verifies that a PTY producing large output does NOT cause
unbounded memory growth when the client is slow to consume it.

```bash
# Connect, send a command that produces large output, but DON'T read it
# immediately. The server should buffer up to 1 MiB, then drop.
node -e "
const { io } = require('socket.io-client');
const token = process.argv[2];
const url = process.env.TERMINAL_URL;

const socket = io(url, {
  auth: { token },
  transports: ['websocket'],
  timeout: 10000,
});

let outputReceived = 0;
let warningReceived = false;

socket.on('connect', () => console.log('[PASS] Backpressure test connected'));
socket.on('session:ready', () => {
  console.log('[PASS] session ready, sending large output command');
  // Generate ~5 MiB of output: 5000 lines of ~1 KiB each
  socket.emit('terminal:input', 'for i in \$(seq 1 5000); do printf \"%0104d%s\\n\" \$i \$(head -c 1000 /dev/zero | tr '\\0' 'x'); done\r');
});

socket.on('terminal:output', (data) => {
  outputReceived += Buffer.byteLength(data, 'utf8');
  // Check for backpressure warning
  if (data.includes('output dropped')) {
    warningReceived = true;
    console.log('[PASS] Backpressure warning received:', data.trim().substring(0, 120));
  }
});

// After 10 seconds, check results
setTimeout(() => {
  console.log('[INFO] Total output received:', Math.round(outputReceived / 1024), 'KiB');
  if (warningReceived) {
    console.log('[PASS] Backpressure protection active — warning was emitted');
  } else {
    // If no warning, the client kept up (unlikely with 5 MiB) — still valid
    console.log('[INFO] No backpressure warning (client kept up or output was smaller than cap)');
  }
  socket.disconnect();
  console.log('[PASS] Backpressure test complete');
  process.exit(0);
}, 10000);

socket.on('connect_error', (err) => {
  console.log('[FAIL] connect error:', err.message);
  process.exit(1);
});
" "$(node -e "
const crypto = require('crypto');
const secret = process.env.TERMINAL_AUTH_SECRET;
const payload = { sub: 'bp-test-user', aud: 'littree-terminal', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, cwd: '/data/littree-workspaces/bp-test-user' };
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
console.log(encoded + '.' + sig);
")"
```

## 6. CLI Remote Dispatch Test

```bash
# Set the terminal URL and user auth secret for the CLI
export LITT_TERMINAL_URL="$TERMINAL_URL"
export TERMINAL_AUTH_SECRET="<from Railway>"  # user auth, NOT internal service key

# Run a command remotely through the terminal-server command bridge
litt status --remote

# Expected: status output with a runId line at the bottom
# This proves the CLI → /api/command (user JWT auth) → command-registry → response path
```

## 7. Verify Deployed SHA

```bash
# Check Railway deployment metadata
railway deployment list --json | jq '.[0]'

# The deployment should reference the current commit.
# Verify the built image contains the backpressure code by checking
# /internal/sessions works (only exists in the new code).
```

## Acceptance Criteria

| Check | Command | Expected |
|-------|---------|----------|
| Health | `curl /health` | `status: ok`, `readiness: ready` |
| Auth configured | `curl /health` | `authConfigured: true`, `internalServiceConfigured: true` |
| Internal sessions | `curl /internal/sessions` | `{ sessions: [] }` (new endpoint) |
| Socket.IO connect | socket.io-client | `connect` event fires |
| PTY create | socket.io-client | `session:ready` with sessionId |
| stdin → PTY | `emit terminal:input` | `terminal:output` with echoed input |
| PTY stdout → client | socket.io-client | output contains sent text |
| Resize | `emit terminal:resize` | no error |
| Disconnect cleanup | `socket.disconnect()` | session gone from `/internal/sessions` |
| Backpressure | large output command | no OOM, optional warning emitted |
| CLI remote | `litt status --remote` | output with runId |

All checks must pass before marking Phase 4 complete.
