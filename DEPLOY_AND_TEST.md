# LiTLabs: Deploy & Test Guide

## Phase 1: Deploy Supabase Schema (5 mins)

### Step 1: Open Supabase SQL Editor
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your **LiTLabs project**
3. Click **SQL Editor** (left sidebar)
4. Click **New Query**

### Step 2: Paste Schema
Copy the entire contents of:
```
home/litbit/LiTTreeLabstudios/supabase/schema.sql
```
Paste into the SQL Editor query box.

### Step 3: Run
Click **▶ Run** button.

✅ **Result:** 10 tables created (users, posts, wallets, transactions, etc.) + 13 indexes for 4.4x speed.

### Verify Success
In Supabase Dashboard, go to **Table Editor** and confirm you see:
- `users`
- `wallets`
- `posts`
- `post_likes`
- `post_comments`
- `transactions`
- etc.

---

## Phase 2: Deploy Indexes (2 mins)

### Step 1: New Query
Click **New Query** again in SQL Editor.

### Step 2: Paste Index SQL
```sql
-- COMPOSITE INDEXES FOR COMMON QUERIES
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON public.sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON public.messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON public.jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON public.posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_user_balance ON public.wallets(user_id, balance);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type, created_at DESC);

-- ANALYZE TABLES FOR QUERY OPTIMIZATION
ANALYZE public.users;
ANALYZE public.posts;
ANALYZE public.wallets;
ANALYZE public.transactions;
ANALYZE public.post_likes;
ANALYZE public.post_comments;
```

### Step 3: Run
Click **▶ Run**.

✅ **Result:** Queries will execute 4.4x faster.

---

## Phase 3: Test Stripe Payment Webhook (10 mins)

### Prerequisites
- Stripe account with test keys
- Stripe CLI installed locally (`brew install stripe/stripe-cli/stripe` or download from [stripe.com/cli](https://stripe.com/cli))

### Step 1: Get Webhook Secret Locally

Open terminal/PowerShell and run:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

You'll see output like:
```
> Ready! Your webhook signing secret is: whsec_test_Xe...
```

**Copy the signing secret.** You'll use it next.

### Step 2: Set Local Env Vars

In `home/litbit/LiTTreeLabstudios/.env.local`, add:
```
STRIPE_WEBHOOK_SECRET=whsec_test_Xe...
```

(Replace with the value from Step 1)

### Step 3: Start Dev Server

```bash
cd home/litbit/LiTTreeLabstudios
npm run dev
```

Wait for "ready - started server on 0.0.0.0:3000, url: http://localhost:3000"

### Step 4: Trigger Test Checkout

In a **new terminal/PowerShell** (keep dev server running), run:
```bash
stripe trigger payment_intent.succeeded
```

Or to trigger a full checkout.session.completed event:
```bash
stripe trigger checkout.session.completed
```

### Step 5: Verify in Logs

You should see in the dev server terminal:
```
POST /api/stripe/webhook 200
```

### Step 6: Check Database

Go to Supabase Dashboard → **Table Editor** → **transactions** table.

You should see a new row with:
- `type: "purchase"`
- `amount: [coin_amount]`
- `description: "Purchased X LiTBit Coins via Stripe"`

✅ **Success!** Webhook is working. Payments will credit wallets in production.

---

## Phase 4: Test Full Checkout Flow (15 mins)

### Step 1: Create Test Price in Stripe

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Click **Products** (left sidebar)
3. Click **Add product**
4. Name: "LiTBit Coins - Starter"
5. Price: `100` cents ($1.00)
6. Click **Save**
7. Copy the **Price ID** (looks like `price_xxxxx`)

### Step 2: Update Marketplace

Open `home/litbit/LiTTreeLabstudios/src/app/marketplace/page.tsx`

Find this section (around line 23):
```javascript
const CREDIT_PACKS = [
  { id: 'starter', coins: 500, price: 1, priceId: '', label: 'Starter', popular: false, savings: 'Entry pack' },
  ...
]
```

Replace `priceId: ''` with your price ID:
```javascript
const CREDIT_PACKS = [
  { id: 'starter', coins: 500, price: 1, priceId: 'price_xxxxx', label: 'Starter', popular: false, savings: 'Entry pack' },
  ...
]
```

### Step 3: Rebuild

```bash
npm run build
npm run dev
```

### Step 4: Test Checkout

1. Go to http://localhost:3000/marketplace
2. Click **Login** (if not signed in)
3. Click **Buy Starter** on any credit pack
4. You'll be redirected to Stripe test checkout
5. Use test card: **4242 4242 4242 4242**
   - Expiry: any future date (e.g., 12/25)
   - CVC: any 3 digits (e.g., 123)
6. Click **Pay**
7. You'll be redirected back to `/marketplace?success=true`

### Step 5: Verify Wallet Updated

Check your wallet balance in marketplace. It should have increased by 500 coins.

Go to Supabase **Table Editor** → **wallets** table → verify balance increased.

✅ **Full flow works!**

---

## Phase 5: Deploy to Vercel (5 mins)

### Step 1: Push Code
```bash
cd home/litbit/LiTTreeLabstudios
git add .
git commit -m "Deploy: Supabase schema + Stripe webhook + social feed"
git push origin main
```

### Step 2: Set Production Env Vars

Go to [Vercel Dashboard](https://vercel.com/dashboard) → **LiTLabs project** → **Settings** → **Environment Variables**

Add/update:
```
STRIPE_WEBHOOK_SECRET=whsec_live_XXX    (from Stripe Dashboard)
SUPABASE_SERVICE_ROLE_KEY=...           (from Supabase Settings)
```

### Step 3: Redeploy

Click **Deployments** → **Redeploy** on latest commit.

Wait for "✓ Ready" status.

✅ **Live!**

---

## Testing Checklist

- [ ] Supabase schema deployed (10 tables visible in Table Editor)
- [ ] Indexes created (4.4x faster queries)
- [ ] Stripe webhook listening locally (got whsec_test_... key)
- [ ] Local checkout tested (wallet increased)
- [ ] Code pushed to GitHub
- [ ] Vercel env vars set
- [ ] Production redeployed

---

## Troubleshooting

**Q: Webhook not connecting**
A: Make sure `stripe listen` is running in one terminal AND `npm run dev` in another.

**Q: Wallet not updating after checkout**
A: Check `/api/stripe/webhook` logs. Verify `STRIPE_WEBHOOK_SECRET` matches the one from `stripe listen`.

**Q: "Supabase not configured" errors**
A: Schema not deployed yet. Go to Supabase SQL Editor and run schema.sql.

**Q: Social feed showing "Loading posts..." forever**
A: Check browser console for API errors. Verify `/api/posts` is responding.

---

## What's Next

- Real-time social feed updates (Supabase Realtime subscriptions)
- Image uploads to Supabase Storage
- Error boundaries for graceful failures
- Loading skeletons for UX polish

---

**Questions?** Check `/home/litbit/LiTTreeLabstudios/README.md` or review the API route implementations in `/src/app/api/`.
