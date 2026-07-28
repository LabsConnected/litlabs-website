-- attach_stripe_prices.sql — idempotent, run per-environment
-- Run after creating Stripe products in each environment's dashboard.
--
-- Usage (psql):
--   psql "$DATABASE_URL" \
--     -v price_growth=price_xxx \
--     -v price_social=price_yyy \
--     -v price_coder_pro=price_zzz \
--     -f supabase/scripts/attach_stripe_prices.sql
--
-- Usage (Supabase SQL editor): replace :'price_growth' with the actual price ID string.

UPDATE public.agent_versions SET stripe_price_id = :'price_growth'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-growth')
  AND version = '1.0.0';

UPDATE public.agent_versions SET stripe_price_id = :'price_social'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-social')
  AND version = '1.0.0';

UPDATE public.agent_versions SET stripe_price_id = :'price_coder_pro'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-coder-pro')
  AND version = '1.0.0';
