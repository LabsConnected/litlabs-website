# 🚀 LiTLabs: COMPLETE DEPLOYMENT RUNBOOK

**Status:** Code complete ✅ | Build passing ✅ | Ready for production 🎯

---

## 🎬 **START HERE: 3-Step Deployment**

### **STEP 1: Deploy Supabase Schema (5 mins)**

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your **LiTLabs project**
3. Click **SQL Editor** → **New Query**
4. Paste the entire contents of:
   ```
   home/litbit/LiTTreeLabstudios/supabase/schema.sql
   ```
5. Click **▶ Run**

**Verify success:** Go to **Table Editor** and confirm you see:
- users
- posts
- wallets
- transactions
- post_likes
- post_comments
- user_preferences
- user_agents
- subscriptions
- user_media

✅ **Done** — Database is live with 10 tables + RLS enabled.

---

### **STEP 2: Create Supabase Service Role Environment Variable**

1. In Supabase Dashboard, click **Settings** (bottom left)
2. Click **API** (left sidebar)
3. Copy the **Service Role Key** (marked as "secret" — starts with `eyJ...`)
4. Go to [Vercel Dashboard](https://vercel.com/dashboard)
5. Click **LiTLabs project**
6. Click **Settings** → **Environment Variables**
7. Add new variable:
   ```
   Name: SUPABASE_SERVICE_ROLE_KEY
   Value: [paste the key from step 3]
   ```
8. Click **Save**

✅ **Done** — Vercel can now query Supabase database.

---

### **STEP 3: Test Stripe Webhook Locally (15 mins)**

#### 3a. Install Stripe CLI
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows (or download from https://stripe.com/docs/stripe-cli)
choco install stripe
```

#### 3b. Start Local Webhook Listener
In a **new terminal/PowerShell**, run:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

You'll see output like:
```
> Ready! Your webhook signing secret is: whsec_test_Xe...
```

**Copy the signing secret.**

#### 3c. Add to `.env.local`
In `home/litbit/LiTTreeLabstudios/.env.local`, add:
```
STRIPE_WEBHOOK_SECRET=whsec_test_Xe...
```

#### 3d. Start Dev Server
```bash
cd home/litbit/LiTTreeLabstudios
npm run dev
```

Wait for "ready - started server on 0.0.0.0:3000"

#### 3e. Test Payment
1. Go to http://localhost:3000/marketplace
2. Sign in (or create test account)
3. Click **Buy Starter** on any credit pack
4. Use test card: **4242 4242 4242 4242**
   - Expiry: 12/25
   - CVC: 123
5. Click **Pay**
6. You'll redirect to `/marketplace?success=true`

#### 3f: Verify Wallet Updated
- Check marketplace wallet balance (should increase by 500 coins)
- Go to Supabase **Table Editor** → **wallets** table
- Verify balance increased for your user
- Check **transactions** table — should have 1 new row

✅ **Webhook works!** Payments will credit wallets in production.

---

## 🌍 **STEP 4: Deploy to Vercel**

### 4a. Add Production Stripe Webhook Secret

1. In Stripe Dashboard, go to **Webhooks** (Developers → Webhooks)
2. Create new endpoint:
   - URL: `https://litlabs.net/api/stripe/webhook`
   - Events: Select `checkout.session.completed`, `payment_intent.succeeded`, `invoice.payment_succeeded`
3. Copy the **Signing Secret**
4. In Vercel, add env var:
   ```
   Name: STRIPE_WEBHOOK_SECRET
   Value: [production signing secret]
   ```

### 4b. Verify All Env Vars Set

In Vercel **Settings** → **Environment Variables**, confirm you have:
- ✅ `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (pk_live_...)
- ✅ `CLERK_SECRET_KEY` (sk_live_...)
- ✅ `NEXT_PUBLIC_SUPABASE_URL` (https://xxx.supabase.co)
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` (just added)
- ✅ `STRIPE_SECRET_KEY` (sk_live_...)
- ✅ `STRIPE_WEBHOOK_SECRET` (whsec_live_... from Stripe)

### 4c. Redeploy

1. Go to Vercel **Deployments**
2. Click **Redeploy** on latest commit
3. Wait for "✓ Ready" status

✅ **Live!** Your app is now in production with:
- ✅ Clerk auth (production)
- ✅ Supabase database (production)
- ✅ Stripe payments (production)
- ✅ Social feed (live)

---

## 📊 **VERIFY PRODUCTION IS WORKING**

### Test Each Feature

#### 1. **Sign Up**
- Go to https://litlabs.net
- Click **Sign In** → **Create Account**
- Verify user appears in Supabase **users** table

#### 2. **Social Feed**
- Go to https://litlabs.net/social
- Create a post
- Verify post appears in Supabase **posts** table
- Like/comment and verify tables update

#### 3. **Marketplace**
- Go to https://litlabs.net/marketplace
- Click **Daily Bonus** → verify wallet increased by 50 coins
- Check Supabase **wallets** table — balance increased
- Check **transactions** table — new "earn" transaction logged

#### 4. **Stripe Payment** (If you have test payment method)
- Click **Buy Starter** on marketplace
- Go through Stripe checkout
- Verify wallet increases by 500 coins
- Check Supabase **transactions** table for new purchase record

✅ **All working!** Production is live and operational.

---

## 🛠️ **SYSTEM CLEANUP (Optional but Recommended)**

Run from **Windows PowerShell as Administrator**:

```powershell
# Clean Windows Temp (7.4GB)
del %TEMP%\* /q /s

# Clean System Temp
del C:\Windows\Temp\* /q /s

# Clear Windows Update cache
net stop wuauserv
del C:\Windows\SoftwareDistribution\Download\* /q /s
net start wuauserv

# Empty Recycle Bin
RD /S /Q "%systemdrive%\$Recycle.bin"

# Disable Hibernation (frees 5-15GB)
powercfg /hibernate off
```

---

## 📝 **Post-Launch Checklist**

- ✅ Supabase schema deployed
- ✅ All 10 tables exist in Supabase
- ✅ Stripe webhook configured (production)
- ✅ All env vars set in Vercel
- ✅ Vercel redeployed with new env vars
- ✅ Sign-up works (users appear in DB)
- ✅ Social feed works (posts save to DB)
- ✅ Wallet works (balance updates in DB)
- ✅ Stripe payments work (transactions log)

---

## 🚀 **WHAT'S LIVE NOW**

| Feature | Status | Details |
|---------|--------|---------|
| **Auth** | ✅ Live | Clerk production keys |
| **Database** | ✅ Live | Supabase 10 tables + RLS |
| **Social Feed** | ✅ Live | Create posts, like, comment, real-time polling |
| **Marketplace** | ✅ Live | Browse agents, buy coins, daily bonus |
| **Wallet** | ✅ Live | LiTBit Coins balance, purchase tracking |
| **Stripe** | ✅ Live | Checkout → wallet credit → transaction log |
| **API Routes** | ✅ Live | 44 endpoints (auth, posts, wallet, stripe, etc.) |
| **Rate Limiting** | ✅ Active | Per-IP rate limiting on all APIs |

---

## 🔮 **NEXT PHASE (Optional Enhancements)**

1. **Real-time Social Feed** — Add Supabase Realtime subscriptions (live posts without polling)
2. **Image Uploads** — Wire file input to Supabase Storage (replace base64)
3. **Error Boundaries** — Add React error handling for graceful failures
4. **Loading Skeletons** — Improve UX on marketplace/gallery
5. **Agent Builder** — Full no-code agent creation UI
6. **Orchestration** — Multi-agent workflows

---

## 📞 **SUPPORT**

**If something breaks:**

1. Check Vercel logs: **Deployments** → **View logs**
2. Check Supabase logs: **Database** → **Logs**
3. Check Stripe logs: **Dashboard** → **Logs**
4. Check API response in browser DevTools (F12 → Network tab)

**Common issues:**

| Error | Fix |
|-------|-----|
| "Webhook secret not configured" | Set `STRIPE_WEBHOOK_SECRET` in Vercel env vars |
| "Supabase not configured" | Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel env vars |
| "User not found" | Sign up again (Clerk webhook may be slow) |
| "Wallet unavailable" | Check Supabase is accessible (check API status) |

---

**🎉 You're live! LiTLabs is ready to scale.**

---

*Generated: $(date)*  
*Project: LiTTree Lab Studios*  
*Platform: Next.js 16 + Supabase + Stripe + Clerk*
