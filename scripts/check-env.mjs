const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY'
];

console.log('Checking required environment variables...\n');

const missing = [];
const present = [];

for (const key of required) {
  const value = process.env[key];
  if (value && value.length > 0) {
    present.push(key);
    console.log(`  ✓ ${key} = ${value.substring(0, 10)}...`);
  } else {
    missing.push(key);
    console.log(`  ✗ ${key} = MISSING`);
  }
}

console.log('\n---');
console.log(`Present: ${present.length}/${required.length}`);
console.log(`Missing: ${missing.length}`);

if (missing.length > 0) {
  console.log('\nMissing variables:', missing.join(', '));
  process.exit(1);
}
