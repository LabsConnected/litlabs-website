# Master Blueprint: LitLabs Full Platform Architecture

## 🏗️ CURRENT INFRASTRUCTURE STATUS

### ✅ WORKING (Local Dev)
- **Frontend**: Next.js 16 app at `/home/litbit/LiTTreeLabstudios/src/app/`
- **Auth**: JWT-based with hardcoded admin credentials
- **AI Chat**: `/api/chat` with OpenRouter/Gemini integration
- **Stripe**: Checkout endpoint configured, webhook secret set
- **UI Components**: Dashboard, Gallery, Builder, Social, Settings

### ⚠️ NEEDS DEPLOYMENT CONFIG
- **R2 Storage**: Code exists, needs env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Stripe Webhook**: Endpoint at `https://litlabs.net/api/stripe/webhook` - add in Stripe Dashboard
- **Database**: Placeholder - uses in-memory/hardcoded user (needs PostgreSQL/Supabase)

---

## 📁 PROJECT STRUCTURE

```
LiTTreeLabstudios/
├── src/app/
│   ├── api/
│   │   ├── auth/         # Login, session, logout
│   │   ├── chat/         # AI chat endpoint
│   │   ├── storage/      # Pre-signed URLs (NEW)
│   │   └── stripe/       # Payments
│   ├── (dashboard)/      # Protected routes
│   │   ├── dashboard/    # User home
│   │   ├── builder/      # Agent creation
│   │   ├── social/       # Social feed
│   │   └── settings/     # User config
│   ├── gallery/          # Agent marketplace
│   ├── login/            # Auth page
│   └── page.tsx          # Landing page
├── src/components/
│   ├── Navbar.tsx        # Top navigation
│   ├── Sidebar.tsx       # Dashboard sidebar
│   └── ChatWidget.tsx    # Floating chat
├── src/lib/
│   ├── db.ts             # User/auth (hardcoded)
│   ├── jwt.ts            # JWT utilities
│   ├── api.ts            # API client
│   ├── storage.ts        # R2 integration (NEW)
│   └── layout-schema.ts  # AI layout generator (NEW)
└── .env.local            # Local config
```

---

## 🔧 REQUIRED ENVIRONMENT VARIABLES

Add these to your production deployment:

```bash
# Cloudflare R2 (Zero egress storage)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key_id
R2_SECRET_ACCESS_KEY=secret
R2_BUCKET_NAME=litlabs-media

# Stripe (Payments)
STRIPE_SECRET_KEY=sk_live_xxx         # DONE
STRIPE_WEBHOOK_SECRET=whsec_xxx       # DONE
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# AI APIs
OPENROUTER_API_KEY=sk-or-v1-xxx       # DONE
GEMINI_API_KEY=xxx                    # DONE
GOOGLE_API_KEY=xxx                    # DONE

# Auth
AUTH_SECRET=xxx                       # DONE
```

---

## 🚀 DEPLOYMENT STEPS

1. **Deploy to Vercel** (recommended) or your host
2. **Add env vars above to production**
3. **In Stripe Dashboard**: Add webhook endpoint `https://litlabs.net/api/stripe/webhook`
4. **In Cloudflare**: Create R2 bucket `litlabs-media`
5. **Test**: Login at `/login`, deploy agent, start chat

---

## 💡 ARCHITECTURE FLOW

User Upload → Pre-signed URL → Direct to R2 → CDN serves media  
AI Request → Chat API → OpenRouter/Gemini → Response  
Payment → Stripe Checkout → Webhook → Subscription granted  

Your dev server at http://localhost:3000 mirrors production structure.