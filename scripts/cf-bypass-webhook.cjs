// Create a Cloudflare WAF rule to bypass Access for n8n webhook paths
const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = "856b63eeee14478c786991bad8bf16ea";

async function main() {
  // First, check existing rules
  const listRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/rules`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await listRes.json();
  console.log("Existing firewall rules:", JSON.stringify(list.result?.map(r => ({ name: r.name, action: r.action, expression: r.expression })), null, 2));

  // Create bypass rule for /webhook/* paths
  const body = [{
    name: "Bypass Access for n8n webhooks",
    expression: '(http.host eq "n8n.litlabs.net" and starts_with(http.request.uri.path, "/webhook/"))',
    action: "bypass",
    action_parameters: {},
    priority: 1,
  }];

  const createRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const create = await createRes.json();
  console.log("Create result:", JSON.stringify(create, null, 2));
}

main().catch(console.error);
