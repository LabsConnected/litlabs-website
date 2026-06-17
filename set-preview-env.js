const { spawn } = require('child_process');
const readline = require('readline');

const PROJECT_ID = 'prj_QBwxOmgCrAaZXwQkkCfBA8H7QgA5';
const TEAM_ID = 'team_jmn8YfmNgFIlt18nh6YfgJ0R';

const envVars = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://rokbfvuoqildggnhappy.supabase.co' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbG...jLRE' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJhbG...I7T0' },
  { name: 'NEXT_PUBLIC_SITE_URL', value: 'https://litlabs.net' },
];

async function setEnvVar(varName, value, env) {
  return new Promise((resolve, reject) => {
    const args = ['env', 'add', varName, env];
    console.log(`Setting ${varName} for ${env}...`);
    
    const proc = spawn('C:\\nvm4w\\nodejs\\vercel.cmd', args, {
      cwd: 'C:\\home\\litbit\\LiTTreeLabstudios\\home\\litbit\\LiTTreeLabstudios',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      
      // Answer interactive prompts
      if (text.includes('which Git branch') || text.includes('Preview branches')) {
        proc.stdin.write('\n'); // empty = all preview branches
      }
      if (text.includes('Overwrite')) {
        proc.stdin.write('y\n');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Send the value with newline
    proc.stdin.write(value + '\n');

    // After a short delay, answer the branch prompt
    setTimeout(() => {
      if (!proc.killed) {
        try { proc.stdin.write('\n'); } catch(e) {}
      }
    }, 2000);

    proc.on('close', (code) => {
      if (code === 0 || stdout.includes('Added')) {
        console.log(`  ✓ ${varName} → ${env}`);
        resolve();
      } else if (stdout.includes('already exists') || stderr.includes('already exists')) {
        console.log(`  ⊙ ${varName} already exists for ${env}`);
        resolve();
      } else {
        console.log(`  ✗ ${varName} failed: ${stdout.slice(0, 200)} ${stderr.slice(0, 100)}`);
        resolve(); // continue anyway
      }
    });
  });
}

async function main() {
  for (const v of envVars) {
    await setEnvVar(v.name, v.value, 'preview');
  }
  console.log('DONE');
}

main();
