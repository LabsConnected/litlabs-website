// Debug the GitHub workflow activation issue
const N8N_URL = 'https://n8n-production-2519.up.railway.app';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjI4MGE2NS02ODM2LTQ0ZTYtYjc3NS1lOTQ3MjE3ZjYyZTEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYTZlZTYyZGYtOTRhYi00ZmFhLTg2ZGYtYWIxMGU2OGVhOTA1IiwiaWF0IjoxNzg1ODY5NzU3LCJleHAiOjE4MTc0MDU3NTU5OTh9.NUL0EhN1J0m3O6qikYPcM-Yahd1e65RL7ZAv9Hcdo_E';

async function main() {
  let res = await fetch(`${N8N_URL}/api/v1/workflows/zvERhR1mRh3tK0dE`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const wf = await res.json();
  
  // Print all nodes with full details
  console.log('=== All nodes ===');
  wf.nodes.forEach(n => {
    console.log(`\n${n.name} | type=${n.type} | version=${n.typeVersion}`);
    console.log('  params:', JSON.stringify(n.parameters, null, 2));
    if (n.credentials) {
      console.log('  credentials:', JSON.stringify(n.credentials));
    }
  });
  
  console.log('\n=== Connections ===');
  console.log(JSON.stringify(wf.connections, null, 2));
}

main().catch(console.error);
