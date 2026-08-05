# Vercel environment variables (production)

Run these on your machine with Vercel CLI:

```bash
npx vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production
npx vercel env add TURNSTILE_SECRET_KEY production
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel env add SLACK_ALERT_WEBHOOK production
```

Local `.env.local` example:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<your-turnstile-site-key>
TURNSTILE_SECRET_KEY=<your-turnstile-secret-key>
UPSTASH_REDIS_REST_URL=https://us1-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=token_xxx
SLACK_ALERT_WEBHOOK=https://hooks.slack.com/services/...
```
