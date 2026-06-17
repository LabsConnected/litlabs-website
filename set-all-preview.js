const { spawn } = require('child_process');
const readline = require('readline');

const cwd = 'C:\\home\\litbit\\LiTTreeLabstudios\\home\\litbit\\LiTTreeLabstudios';

const vars = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://rokbfvuoqildggnhappy.supabase.co', sensitive: false },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbG...jLRE', sensitive: false },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJhbG...I7T0', sensitive: true },
  { name: 'NEXT_PUBLIC_SITE_URL', value: 'https://litlabs.net', sensitive: false },
];

function setVar(v) {
  return new Promise((resolve) => {
    console.log(`\n=== Setting ${v.name} for preview ===`);
    const p = spawn('vercel', ['env', 'add', v.name, 'preview'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let out = '', err = '';
    p.stdout.on('data', d => {
      const text = d.toString();
      out += text;
      process.stdout.write(text);
      
      // Handle "Is it a sensitive secret?" prompt
      if (text.includes('sensitive secret')) {
        p.stdin.write(v.sensitive ? 'Y\n' : 'n\n');
      }
      // Handle "which Git branch?" prompt
      if (text.includes('which Git branch') || text.includes('Preview branches')) {
        p.stdin.write('\n'); // empty = all branches
      }
      // Handle "Leave as is / Rename" prompt
      if (text.includes('Leave as is') || text.includes('How to proceed')) {
        p.stdin.write('\n'); // select first option
      }
    });
    p.stderr.on('data', d => { err += d; process.stderr.write(d); });
    
    // Send the value first
    p.stdin.write(v.value + '\n');
    
    p.on('close', (code) => {
      console.log(`\n${v.name}: exit code ${code}`);
      resolve();
    });
    
    // Timeout safety
    setTimeout(() => {
      if (!p.killed) {
        console.log(`Timeout killing ${v.name}`);
        p.kill();
      }
    }, 30000);
  });
}

(async () => {
  for (const v of vars) {
    await setVar(v);
  }
  
  // Verify
  console.log('\n=== Verifying preview env vars ===');
  const verify = spawn('vercel', ['env', 'ls', 'preview'], { cwd, stdio: 'inherit' });
  verify.on('close', () => {
    console.log('\n=== ALL DONE ===');
    process.exit(0);
  });
})();
