-- Seed: Discover welcome posts from the LiTT team
-- ============================================================
-- HOW TO RUN (Larry, ~1 minute, Supabase dashboard):
--   1. Open the Supabase dashboard for the production project
--      ("supabase-sky-candle").
--   2. Go to SQL Editor → New query.
--   3. Paste this entire file and click Run.
--   4. Open https://www.litlabs.net/discover — the welcome posts
--      should be there. (The "Community" nav link ships in the
--      companion code PR; merge that first or the nav won't show it.)
--
-- IDEMPOTENT: safe to re-run. The team user is upserted by email and
-- posts are inserted only when the team has none yet, so re-runs are
-- no-ops. No schema changes — data only.
-- ============================================================

DO $$
DECLARE
  team_id uuid;
BEGIN
  -- 1. LiTT-team author. clerk_id is synthetic ('seed:litt-team') because
  --    this author never signs in via Clerk; it is only a unique key.
  INSERT INTO public.users (clerk_id, email, name, username, display_name, bio)
  VALUES (
    'seed:litt-team',
    'team@litlabs.net',
    'LiTT Team',
    'litt',
    'LiTT Team',
    'The team behind LiTT — the AI workspace that turns an idea into an operating business.'
  )
  ON CONFLICT DO NOTHING;

  SELECT id INTO team_id FROM public.users WHERE email = 'team@litlabs.net';
  IF team_id IS NULL THEN
    RAISE EXCEPTION 'discover seed: could not resolve the LiTT-team user (email team@litlabs.net)';
  END IF;

  -- 2. Welcome posts — oldest first; only when the team has none yet.
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE user_id = team_id) THEN
    INSERT INTO public.posts (user_id, content, post_type, visibility, created_at)
    VALUES
      (team_id, $seed1$Welcome to Discover — the community home for people building with LiTT. 🚀

This is where builders share what they are shipping, ask questions, and show what is possible when you describe an idea once and let LiTT do the rest.

Introduce yourself in the replies: what are you building?$seed1$, 'text', 'public', now() - interval '30 hours'),
      (team_id, $seed2$LiTT turns an idea into an operating business — not just a published website.

Describe what you want once. LiTT plans it, builds it, and wires up the real stuff: lead capture, booking, payments, email, your domain. Then you publish without ever touching hosting or DNS.

That is the bar. Discover is where you will watch it happen first.$seed2$, 'text', 'public', now() - interval '24 hours'),
      (team_id, $seed3$How Discover works:

📣 Share — post your builds, wins, and works-in-progress.
❓ Ask — stuck on something? The community and the team are here.
💡 Learn — patterns and tips from people shipping real businesses on LiTT.

Sign in to post. Real builds only — if you share it, it should actually exist.$seed3$, 'text', 'public', now() - interval '18 hours'),
      (team_id, $seed4$Discover house rules, short version:

1. Be kind — builders at every level are welcome here.
2. No spam, no scams, no crypto schemes.
3. Share real work.
4. Help before you promote.

We keep this place useful. Rule-breaking posts come down. — the LiTT team$seed4$, 'text', 'public', now() - interval '12 hours'),
      (team_id, $seed5$LiTT tip: the more concrete your first description, the better the build.

"A booking site for my cleaning business in Austin with online payments" beats "a website for my business" every time.

Describe once. LiTT handles the rest.$seed5$, 'text', 'public', now() - interval '6 hours'),
      (team_id, $seed6$It is launch-week energy every week around here. 🔥

Drop a reply: what are you building with LiTT right now? Even if it is just an idea — describe it in one paragraph. The best answers get featured.$seed6$, 'text', 'public', now() - interval '1 hour');
  END IF;
END $$;
