// Debug the workflow update errors
const N8N_URL = 'https://n8n-production-2519.up.railway.app';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjI4MGE2NS02ODM2LTQ0ZTYtYjc3NS1lOTQ3MjE3ZjYyZTEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYTZlZTYyZGYtOTRhYi00ZmFhLTg2ZGYtYWIxMGU2OGVhOTA1IiwiaWF0IjoxNzg1ODY5NzU3LCJleHAiOjE4MTc0MDU3NTU5OTh9.NUL0EhN1J0m3O6qikYPcM-Yahd1e65RL7ZAv9Hcdo_E';

async function main() {
  // Get Stripe workflow
  let res = await fetch(`${N8N_URL}/api/v1/workflows/MSCCAYMuSRx3AvvW`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const stripeWf = await res.json();
  
  // Check current nodes
  console.log('Stripe workflow nodes:');
  stripeWf.nodes.forEach(n => {
    console.log(`  ${n.name} | type=${n.type} | credentials=${JSON.stringify(n.credentials || {})}`);
  });
  
  // Replace Slack node with HTTP Request
  stripeWf.nodes = stripeWf.nodes.map(n => {
    if (n.type === 'n8n-nodes-base.slack') {
      return {
        parameters: {
          method: 'POST',
          url: '={{ $env.SLACK_WEBHOOK_URL }}',
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: 'text', value: 'New Stripe customer onboarded' }
            ]
          },
          options: {}
        },
        name: 'Notify Slack',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [880, 300]
      };
    }
    return n;
  });
  
  // Try update
  res = await fetch(`${N8N_URL}/api/v1/workflows/MSCCAYMuSRx3AvvW`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: stripeWf.name,
      nodes: stripeWf.nodes,
      connections: stripeWf.connections,
      settings: stripeWf.settings
    })
  });
  console.log('\nStripe update status:', res.status);
  const text = await res.text();
  console.log('Response:', text.substring(0, 500));
  
  // Try activating GitHub workflow
  console.log('\n--- GitHub workflow activation ---');
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  console.log('Activate status:', res.status);
  const actText = await res.text();
  console.log('Response:', actText.substring(0, 500));
}

main().catch(console.error);
