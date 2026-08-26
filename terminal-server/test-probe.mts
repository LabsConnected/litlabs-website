import {ClerkCliAuth} from "../packages/litt-cli/dist/lib/auth/clerk-auth.js";

const TERMINAL_URL = "https://litlabs-terminal-server-production-0be1.up.railway.app";

const auth = new ClerkCliAuth({clientId:'YWeGjVVwoNnX4RTY', issuer:'https://clerk.litlabs.net'});
const clerkToken = await auth.getAccessToken();
const tr = await fetch(`${TERMINAL_URL}/api/token-exchange`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${clerkToken}` },
});
const {terminalToken} = await tr.json();

async function doCmd(args: string[]) {
  const r = await fetch(`${TERMINAL_URL}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${terminalToken}` },
    body: JSON.stringify({ command: '/do', args }),
    signal: AbortSignal.timeout(30_000),
  });
  return r.json();
}

// B. runner-ok
const r1 = await doCmd(['node', '-e', "console.log('runner-ok')"]);
console.log('B. runner-ok:', r1.ok, r1.result?.data?.stdout?.trim());

// C. git branch (git not installed, but should fail gracefully)
const r2 = await doCmd(['node', '-e', "console.log(process.cwd())"]);
console.log('C. pwd:', r2.ok, r2.result?.data?.stdout?.trim());

// G. 500 KB output
const r3 = await doCmd(['node', '-e', "process.stdout.write('x'.repeat(500000))"]);
console.log('G. 500KB:', r3.ok, r3.result?.data?.stdout?.length, 'bytes');

// D. long-running + cancel
const runId = `test_cancel_${Date.now()}`;
const longPromise = doCmd(['node', '-e', "setTimeout(()=>console.log('done'),10000)"]);
await new Promise(r => setTimeout(r, 1000));
const cancelRes = await fetch(`${TERMINAL_URL}/api/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${terminalToken}` },
  body: JSON.stringify({ runId }),
});
const cancelJson = await cancelRes.json();
console.log('D. cancel:', cancelJson);

// Wait for long command to finish (it should be cancelled)
const longResult = await longPromise;
console.log('D. long result:', longResult.ok, longResult.result?.data?.status);
