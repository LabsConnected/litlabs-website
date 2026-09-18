-- Seed canonical pricing v1 — legacy-parity version.
--
-- Registers the immutable pricing/exchange-rate version identifiers that
-- src/lib/billing/canonical-pricing.ts stamps on every credit_ledger charge,
-- plus a reference pricing_catalog mirroring the currently enforced rates.
--
-- v1 deliberately preserves the two legacy effective exchange rates as
-- distinct pricing lanes inside ONE versioned contract:
--   - generation lane: ~100 LiTTBits per USD (1 bit = $0.01)
--   - llm lane: ~1,000 LiTTBits per USD-equivalent before margin
-- Unifying them into a single bits/$ rate is an economics decision gated on
-- shadow comparison (see littbits-pricing-v2-shadow-unified rating rows) and
-- must not ship silently.
--
-- All inserts are idempotent (ON CONFLICT DO NOTHING) so this migration is
-- safe to re-apply.

BEGIN;

-- ── Exchange rate versions ────────────────────────────────────────────────
-- v1 exchange rate is expressed on the generation lane (100 bits per USD);
-- the LLM lane's effective rate is carried in its catalog customer rates.
INSERT INTO public.exchange_rate_versions
  (id, label, bits_per_usd_micro_num, bits_per_usd_micro_den, effective_from, approved_by)
VALUES
  ('littbits-exchange-v1',
   'v1 — legacy parity: generation lane 100 bits/USD; LLM lane ~1000 bits/USD-equivalent (catalog-pinned)',
   100, 1000000, '2026-09-01T00:00:00Z', 'system:phase4-unification')
ON CONFLICT (id) DO NOTHING;

-- ── Pricing versions ──────────────────────────────────────────────────────
INSERT INTO public.pricing_versions
  (id, label, effective_from, exchange_rate_version_id,
   default_margin_bps, default_infra_allowance_micros,
   default_risk_reserve_bps, default_payment_allocation_bps, approved_by)
VALUES
  ('littbits-pricing-v1',
   'v1 — legacy parity: pins the generation and LLM lane rates enforced at unification time',
   '2026-09-01T00:00:00Z', 'littbits-exchange-v1',
   5000, 10000, 1000, 300, 'system:phase4-unification'),
  ('littbits-pricing-v2-shadow-unified',
   'v2 shadow — candidate unified 100 bits/USD lane; rating-only, never enforced',
   '2026-09-01T00:00:00Z', 'littbits-exchange-v1',
   5000, 10000, 1000, 300, 'pending:shadow-comparison')
ON CONFLICT (id) DO NOTHING;

-- ── Reference catalog (mirrors enforced rates) ────────────────────────────
-- customer_rate_micros = the enforced retail price per unit converted to USD
-- micros on the capability's lane. provider_rate_micros = provider cost.
-- Flat-priced routes (music/tts/edit-image) are recorded with their enforced
-- flat customer price — including where that price is below provider cost,
-- which is exactly the data the unification review needs.
INSERT INTO public.pricing_catalog
  (pricing_version_id, provider, model, capability, unit,
   provider_rate_micros, customer_rate_micros, billing_class, minimum_bits, effective_from)
VALUES
  -- ── Generation lane: image (per image) ──
  ('littbits-pricing-v1', 'gemini', 'gemini-3.1-flash-lite-image', 'image', 'image', 30000, 60000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'gemini', 'gemini-3.1-flash-image', 'image', 'image', 40000, 80000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'gemini', 'gemini-3-pro-image', 'image', 'image', 80000, 140000, 'premium', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'gemini', 'gemini-2.5-flash-image', 'image', 'image', 40000, 80000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'alibaba', 'qwen-image-2.0', 'image', 'image', 10000, 30000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'cloudflare', 'flux-1-schnell', 'image', 'image', 0, 0, 'free', 0, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'fal', 'flux-pro', 'image', 'image', 50000, 90000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'together', 'flux-1-schnell-free', 'image', 'image', 0, 0, 'free', 0, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openai', 'dall-e-3', 'image', 'image', 40000, 80000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'recraft', 'recraft-v3', 'image', 'image', 40000, 80000, 'premium', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'pollinations', 'flux', 'image', 'image', 0, 0, 'free', 0, '2026-09-01T00:00:00Z'),

  -- ── Generation lane: video ──
  ('littbits-pricing-v1', 'veo', 'veo-3.1-fast-generate-preview', 'video', 'video_second', 100000, 150000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'veo', 'veo-3.1-fast-1080p', 'video', 'video_second', 120000, 180000, 'premium', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'alibaba', 'happyhorse-1.1-i2v', 'video', 'video', 200000, 300000, 'standard', 1, '2026-09-01T00:00:00Z'),

  -- ── Generation lane: music / speech ──
  -- Enforced flat route prices (music=3, tts=2 bits) are below provider cost
  -- in some lanes — recorded truthfully for the economics review.
  ('littbits-pricing-v1', 'google', 'lyria-3-clip-preview', 'music', 'request', 40000, 30000, 'flat', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'google', 'lyria-3-pro-preview', 'music', 'request', 80000, 120000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'elevenlabs', 'music_v2', 'music', 'request', 80000, 120000, 'premium', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'mureka', 'mureka-default', 'music', 'request', 50000, 80000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'groq', 'whisper-large-v3-turbo', 'speech', 'request', 10000, 20000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'elevenlabs', 'tts', 'speech', 'request', 30000, 20000, 'flat', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'gemini', 'gemini-3.1-flash-lite-image', 'image_edit', 'image', 30000, 20000, 'flat', 1, '2026-09-01T00:00:00Z'),

  -- ── LLM lane (per 1K tokens, blended prompt+completion average) ──
  -- customer_rate_micros = baseBitsPer1K converted at the LLM lane
  -- (~1000 bits per USD-equivalent → 1 bit/1K = 1000 micros).
  ('littbits-pricing-v1', 'gemini', 'gemini-2.5-flash', 'llm', 'token_1k', 188, 1000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'gemini', 'gemini-2.5-flash-lite', 'llm', 'token_1k', 94, 500, 'free', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'groq', 'openai/gpt-oss-120b', 'llm', 'token_1k', 690, 2000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-free', 'openrouter/free', 'llm', 'token_1k', 0, 500, 'free', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-qwen', 'nvidia/nemotron-3-super-120b-a12b:free', 'llm', 'token_1k', 0, 1000, 'code', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-deepseek', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'llm', 'token_1k', 0, 2000, 'reasoning', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-llama', 'google/gemma-4-31b-it:free', 'llm', 'token_1k', 0, 1000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-mistral', 'nex-agi/nex-n2.5-pro:free', 'llm', 'token_1k', 0, 1000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-trinity', 'nvidia/nemotron-3.5-lightning:free', 'llm', 'token_1k', 0, 2000, 'reasoning', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openrouter-vision', 'google/gemma-4-31b-it:free', 'llm', 'token_1k', 0, 1000, 'standard', 1, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'openai', 'gpt-4o', 'llm', 'token_1k', 6250, 0, 'byok', 0, '2026-09-01T00:00:00Z'),
  ('littbits-pricing-v1', 'anthropic', 'claude-sonnet-4-5', 'llm', 'token_1k', 9000, 0, 'byok', 0, '2026-09-01T00:00:00Z')
ON CONFLICT DO NOTHING;

COMMIT;
