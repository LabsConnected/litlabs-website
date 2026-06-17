const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');

const content = `NEXT_PUBLIC_SUPABASE_URL=https://rokbfvuoqildggnhappy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${'eyJhbG...jLRE'}
SUPABASE_SERVICE_ROLE_KEY=${'eyJhbG...I7T0'}
SUPABASE_JWT_SECRET=/i/wwX...
NEXT_PUBLIC_SITE_URL=https://litlabs.net
GEMINI_API_KEY=
OPENROUTER_API_KEY=
`;

fs.writeFileSync(envPath, content.trim() + '\n');
console.log('Written to', envPath);
console.log('Content:');
console.log(fs.readFileSync(envPath, 'utf8'));
