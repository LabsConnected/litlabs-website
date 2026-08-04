// Rebuild GitHub workflow with compatible nodes
const N8N_URL = 'https://n8n-production-2519.up.railway.app';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjI4MGE2NS02ODM2LTQ0ZTYtYjc3NS1lOTQ3MjE3ZjYyZTEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYTZlZTYyZGYtOTRhYi00ZmFhLTg2ZGYtYWIxMGU2OGVhOTA1IiwiaWF0IjoxNzg1ODY5NzU3LCJleHAiOjE4MTc0MDU3NTU5OTh9.NUL0EhN1J0m3O6qikYPcM-Yahd1e65RL7ZAv9Hcdo_E';

async function main() {
  // Get the existing workflow to preserve credentials
  let res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const wf = await res.json();
  
  // Get the Supabase credentials from existing node
  const supabaseCreds = wf.nodes.find(n => n.type === 'n8n-nodes-base.supabase')?.credentials;
  
  // Rebuild with simple, compatible nodes
  const newNodes = [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'github-sync',
        responseMode: 'onReceived',
        options: {}
      },
      name: 'GitHub Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [250, 300]
    },
    {
      parameters: {
        jsCode: `// Parse GitHub webhook event
const body = $input.first().json.body || $input.first().json;
const event = body.action || 'unknown';
const repo = body.repository?.full_name || 'unknown';
const pr = body.pull_request;
return [{ json: { event, repo, pr_title: pr?.title || '', pr_user: pr?.user?.login || '', raw: JSON.stringify(body).substring(0, 500) } }];`
      },
      name: 'Parse GitHub Event',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [450, 300]
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ $env.DISCORD_WEBHOOK_URL }}',
        sendBody: true,
        contentType: 'json',
        specifiBody: true,
        jsonBody: '={"content": "New GitHub PR: {{ $json.pr_title }} by {{ $json.pr_user }}"}',
        options: {}
      },
      name: 'Notify Discord',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.1,
      position: [670, 300]
    }
  ];
  
  const newConnections = {
    'GitHub Webhook': {
      main: [[{ node: 'Parse GitHub Event', type: 'main', index: 0 }]]
    },
    'Parse GitHub Event': {
      main: [[{ node: 'Notify Discord', type: 'main', index: 0 }]]
    }
  };
  
  // Update the workflow
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: wf.name,
      nodes: newNodes,
      connections: newConnections,
      settings: { executionOrder: 'v1' }
    })
  });
  console.log('Update GitHub workflow:', res.status);
  if (!res.ok) {
    const text = await res.text();
    console.log('Error:', text.substring(0, 400));
    return;
  }
  
  // Activate
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
  data.data.forEach(w => {
    console.log(`${w.name} | active=${w.active}`);
  });
}

main().catch(console.error);
