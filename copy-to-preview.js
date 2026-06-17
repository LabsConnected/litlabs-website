const { spawn } = require('child_process');
const cwd = 'C:\\home\\litbit\\LiTTreeLabstudios\\home\\litbit\\LiTTreeLabstudios';

// First, let's get the production env var IDs by listing them
// Then use the API to create preview copies

// Step 1: Use vercel env ls to get the IDs (it shows encrypted values but we need IDs)
// Actually, let's just use a different approach: remove and re-add with --yes flag

const vars = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://rokbfvuoqildggnhappy.supabase.co' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbG...jLRE' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJhbG...I7T0' },
  { name: 'NEXT_PUBLIC_SITE_URL', value: 'https://litlabs.net' },
];

function runCmd(args, input) {
  return new Promise((resolve) => {
    const p = spawn('vercel', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    if (input) p.stdin.write(input);
    p.stdin.end();
    p.on('close', () => resolve({ out, err }));
  });
}

(async () => {
  for (const v of vars) {
    // Remove if exists
    await runCmd(['env', 'rm', v.name, 'preview', '--yes']);
    
    // Add with value piped - the interactive prompt will still block
    // Let's try using echo with the value
    const result = await runCmd(['env', 'add', v.name, 'preview'], v.value + '\n');
    console.log(v.name + ':', result.out.slice(0, 200));
  }
})();
