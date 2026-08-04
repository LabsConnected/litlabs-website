// Fix activation issues — Gmail node params and HTTP Request node
const N8N_URL = 'https://n8n-production-2519.up.railway.app';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjI4MGE2NS02ODM2LTQ0ZTYtYjc3NS1lOTQ3MjE3ZjYyZTEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYTZlZTYyZGYtOTRhYi00ZmFhLTg2ZGYtYWIxMGU2OGVhOTA1IiwiaWF0IjoxNzg1ODY5NzU3LCJleHAiOjE4MTc0MDU3NTU5OTh9.NUL0EhN1J0m3O6qikYPcM-Yahd1e65RL7ZAv9Hcdo_E';

async function main() {
  // === Fix Stripe workflow — Gmail node needs proper parameters ===
  let res = await fetch(`${N8N_URL}/api/v1/workflows/MSCCAYMuSRx3AvvW`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const stripeWf = await res.json();
  
  // Check current Gmail node
  const gmailNode = stripeWf.nodes.find(n => n.type === 'n8n-nodes-base.gmail');
  console.log('Gmail node params:', JSON.stringify(gmailNode?.parameters, null, 2));
  
  // Fix Gmail node with proper parameters
  stripeWf.nodes = stripeWf.nodes.map(n => {
    if (n.type === 'n8n-nodes-base.gmail') {
      return {
        ...n,
        parameters: {
          resource: 'message',
          operation: 'send',
          sendTo: 'to',
          to: '={{ $json.customer_email }}',
          subject: 'Welcome to LiTTree Lab Studios!',
          emailType: 'html',
          message: '<h1>Welcome to LiTTree Lab Studios!</h1><p>Thanks for joining. Your account is now active.</p><p>Get started at <a href="https://litlabs.net/studio">Studio</a></p>',
          options: {}
        }
      };
    }
    return n;
  });
  
  res = await fetch(`${N8N_URL}/api/v1/workflows/MSCCAYMuSRx3AvvW`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: stripeWf.name,
      nodes: stripeWf.nodes,
      connections: stripeWf.connections,
      settings: { executionOrder: 'v1' }
    })
  });
  console.log('Stripe update:', res.status);
  
  // Activate Stripe
  res = await fetch(`${N8N_URL}/api/v1/workflows/MSCCAYMuSRx3AvvW/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  console.log('Activate Stripe:', res.status);
  if (!res.ok) {
    const text = await res.text();
    console.log('Error:', text.substring(0, 400));
  }
  
  // === Fix GitHub workflow — HTTP Request node needs proper format ===
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const githubWf = await res.json();
  
  // Check current Discord node
  const discordNode = githubWf.nodes.find(n => n.name === 'Notify Discord');
  console.log('\nDiscord node type:', discordNode?.type);
  console.log('Discord params:', JSON.stringify(discordNode?.parameters, null, 2));
  
  // Fix the HTTP Request node — use jsonBody with specifiBody
  githubWf.nodes = githubWf.nodes.map(n => {
    if (n.name === 'Notify Discord') {
      return {
        parameters: {
          method: 'POST',
          url: '={{ $env.DISCORD_WEBHOOK_URL }}',
          sendBody: true,
          contentType: 'json',
          specifiBody: true,
          jsonBody: '={"content": "New GitHub PR opened"}',
          options: {}
        },
        name: 'Notify Discord',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [880, 300]
      };
    }
    return n;
  });
  
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: githubWf.name,
      nodes: githubWf.nodes,
      connections: githubWf.connections,
      settings: { executionOrder: 'v1' }
    })
  });
  console.log('\nGitHub update:', res.status);
  
  // Activate GitHub
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  console.log('Activate GitHub:', res.status);
  if (!res.ok) {
    const text = await res.text();
    console.log('Error:', text.substring(0, 400));
  }
  
  // Final status
  res = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const data = await res.json();
  console.log('\n=== Final status ===');
  data.data.forEach(wf => {
    console.log(`${wf.name} | active=${wf.active}`);
  });
}

main().catch(console.error);
