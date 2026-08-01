-- attach_stripe_prices.sql
--
-- Run this AFTER creating Stripe products/prices in the Stripe Dashboard.
-- This script is environment-specific: the Price IDs it sets are different
-- for test vs live mode. Never commit real Price IDs to the migration.
--
-- Usage (replace the placeholder Price IDs with your actual Stripe prices):
--
--   supabase db execute --file supabase/scripts/attach_stripe_prices.sql
--
-- Or paste into the Supabase SQL Editor after replacing the placeholders.

-- Replace these with your actual Stripe Price IDs (format: price_...)
UPDATE public.agent_versions
SET stripe_price_id = 'price_REPLACE_LITT_GROWTH'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-growth')
  AND version = '1.0.0';

UPDATE public.agent_versions
SET stripe_price_id = 'price_REPLACE_LITT_SOCIAL'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-social')
  AND version = '1.0.0';

UPDATE public.agent_versions
SET stripe_price_id = 'price_REPLACE_LITT_CODER_PRO'
WHERE agent_id = (SELECT id FROM public.agents WHERE slug = 'litt-coder-pro')
  AND version = '1.0.0';

-- Verify all three have Price IDs:
SELECT a.slug, av.version, av.stripe_price_id, av.price_cents, av.currency, av.status
FROM public.agent_versions av
JOIN public.agents a ON a.id = av.agent_id
WHERE a.slug IN ('litt-growth', 'litt-social', 'litt-coder-pro');
