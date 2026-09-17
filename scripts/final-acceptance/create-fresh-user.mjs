/**
 * Create a disposable Clerk user for a production acceptance run.
 *
 * The user is intentionally created by the CI job immediately before the
 * browser journey. No password, email delivery, or existing QA identity is
 * involved; the sign-in token endpoint authenticates this exact new user.
 */
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) throw new Error("CLERK_SECRET_KEY is required");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const email = `litt-acceptance-${stamp}@litlabs.net`;
const response = await fetch("https://api.clerk.com/v1/users", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email_address: [email],
    email_address_identification_status: ["reserved"],
    first_name: "LiTT",
    last_name: "Acceptance",
    public_metadata: { littAcceptance: true, createdAt: new Date().toISOString() },
    skip_password_requirement: true,
  }),
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  throw new Error(`Clerk fresh-user creation failed: HTTP ${response.status} ${body.slice(0, 500)}`);
}

const user = await response.json();
if (typeof user?.id !== "string" || !/^user_[A-Za-z0-9]+$/.test(user.id)) {
  throw new Error("Clerk fresh-user creation returned no valid user id");
}

// stdout is consumed by the workflow output and contains no credentials.
process.stdout.write(user.id);
