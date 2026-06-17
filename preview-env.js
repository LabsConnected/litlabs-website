const { spawn } = require('child_process');
const path = require('path');

const cwd = 'C:\\home\\litbit\\LiTTreeLabstudios\\home\\litbit\\LiTTreeLabstudios';

const vars = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://rokbfvuoqildggnhappy.supabase.co' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbG...jLRE' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJhbG...I7T0' },
  { name: 'NEXT_PUBLIC_SITE_URL', value: 'https://litlabs.net' },
];

function setVar(v) {
  return new Promise((resolve) => {
    const p = spawn('vercel', ['env', 'add', v.name, 'preview'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    
    // Send value
    p.stdin.write(v.value + '\n');
    
    // Answer interactive prompts after delays
    setTimeout(() => { try { p.stdin.write('\n'); } catch(e) {} }, 1500);
    setTimeout(() => { try { p.stdin.write('\n'); } catch(e) {} }, 3000);
    setTimeout(() => { try { p.stdin.write('\n'); } catch(e) {} }, 4500);
    
    p.on('close', (code) => {
      console.log(`${v.name}: code=${code} out=${out.slice(0,100)} err=${err.slice(0,50)}`);
      resolve();
    });
    
    setTimeout(() => { try { p.kill(); } catch(e) {} }, 10000);
  });
}

(async () => {
  for (const v of vars) {
    await setVar(v);
  }
  console.log('DONE');
})();
