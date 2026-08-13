// Fix GitHub workflow — try different HTTP Request node version
const N8N_URL = 'https://n8n-production-2519.up.railway.app';
const N8N_KEY = process.env.N8N_API_KEY || '';

async function main() {
  // Get GitHub workflow
  let res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const githubWf = await res.json();
  
  // Print all nodes to see what's happening
  console.log('GitHub workflow nodes:');
  githubWf.nodes.forEach(n => {
    console.log(`  ${n.name} | type=${n.type} | version=${n.typeVersion}`);
  });
  
  // Try with typeVersion 4.1 (older, more stable)
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
        typeVersion: 4.1,
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
  
  // Try activating
  res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  console.log('Activate GitHub:', res.status);
  if (!res.ok) {
    const text = await res.text();
    console.log('Error:', text.substring(0, 400));
    
    // If still failing, try removing the node entirely and see if the rest works
    console.log('\nTrying without Discord node...');
    res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
      headers: { 'X-N8N-API-KEY': N8N_KEY }
    });
    const wf2 = await res.json();
    
    // Remove Discord node and its connections
    const filteredNodes = wf2.nodes.filter(n => n.name !== 'Notify Discord');
    const filteredConnections = { ...wf2.connections };
    // Remove any connections to/from Notify Discord
    Object.keys(filteredConnections).forEach(key => {
      if (key === 'Notify Discord') {
        delete filteredConnections[key];
      }
      // Remove connections that point to Notify Discord
      if (filteredConnections[key]) {
        Object.keys(filteredConnections[key]).forEach(outputKey => {
          if (filteredConnections[key][outputKey]) {
            filteredConnections[key][outputKey] = filteredConnections[key][outputKey].filter(
              (conns) => !conns.some(c => c.node === 'Notify Discord')
            );
          }
        });
      }
    });
    
    res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
      method: 'PUT',
      headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: wf2.name,
        nodes: filteredNodes,
        connections: filteredConnections,
        settings: { executionOrder: 'v1' }
      })
    });
    console.log('Update without Discord:', res.status);
    
    res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE/activate`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': N8N_KEY }
    });
    console.log('Activate without Discord:', res.status);
    if (!res.ok) {
      const text = await res.text();
      console.log('Error:', text.substring(0, 400));
    }
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

