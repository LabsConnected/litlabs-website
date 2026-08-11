// Add n8n-hook.litlabs.net ingress rule to the Cloudflare Tunnel via API
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = "b05fa9d23a442d5ca2f6a5b1cd8380f7";
const tunnelId = "8a995361-6c8b-42d8-93d0-5f04d1214c0b";

async function main() {
  // Get current tunnel configuration
  const configRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const config = await configRes.json();
  console.log("Current config:", JSON.stringify(config.result?.config?.ingress?.map(i => ({ hostname: i.hostname, service: i.service })), null, 2));

  if (!config.success) {
    console.error("Failed to get config:", JSON.stringify(config));
    return;
  }

  // Add n8n-hook.litlabs.net before the catch-all
  const ingress = config.result.config.ingress;
  const newIngress = [
    ...ingress.filter(i => i.hostname !== "n8n-hook.litlabs.net"),
  ];

  // Insert before the last (catch-all) entry
  const catchAll = newIngress.pop();
  newIngress.push({
    hostname: "n8n-hook.litlabs.net",
    service: "http://localhost:5678",
  });
  newIngress.push(catchAll);

  // Update the tunnel configuration
  const updateBody = {
    config: {
      ...config.result.config,
      ingress: newIngress,
    },
  };

  const updateRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    }
  );
  const update = await updateRes.json();
  console.log("Update result:", JSON.stringify({ success: update.success, errors: update.errors }, null, 2));

  if (update.success) {
    console.log("Added n8n-hook.litlabs.net → http://localhost:5678 to tunnel config");
  }
}

main().catch(console.error);
