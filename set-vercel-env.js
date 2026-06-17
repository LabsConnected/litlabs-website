const { execSync } = require('child_process');

const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://rokbfvuoqildggnhappy.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbG...jLRE',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbG...I7T0',
  SUPABASE_JWT_SECRET: '/i/wwXXYgvfUFhd2Zn5NCXhLMJ1sAYhAopkOyDiM06CCfaHVtw4GxWj38AjnJvvcOd2OEXEPrLbXRL9916/a6Q==',
  NEXT_PUBLIC_SITE_URL: 'https://litlabs.net',
};

const environments = ['production', 'preview'];

for (const [name, value] of Object.entries(env)) {
  for (const envType of environments) {
    try {
      execSync(`vercel env add ${name} ${envType}`, {
        input: value + '\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      console.log(`✓ ${name} → ${envType}`);
    } catch (err) {
      console.log(`✗ ${name} → ${envType}: ${err.message.slice(0, 100)}`);
    }
  }
}

console.log('DONE');
