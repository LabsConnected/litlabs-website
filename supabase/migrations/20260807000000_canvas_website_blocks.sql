-- ============================================
-- Canvas website builder blocks — extends the
-- canvas_blocks type CHECK to include website
-- component blocks: hero, navbar, features,
-- pricing, cta, footer, gallery, testimonial.
--
-- These blocks render as live React components
-- in the studio and can be exported to code.
-- ============================================

BEGIN;

-- Drop the old CHECK and add an expanded one with website block types
ALTER TABLE public.canvas_blocks DROP CONSTRAINT IF EXISTS canvas_blocks_type_check;

ALTER TABLE public.canvas_blocks ADD CONSTRAINT canvas_blocks_type_check
  CHECK (type IN (
    -- Existing document/work blocks
    'heading','paragraph','checklist','task','code','note','decision','image','file','preview',
    -- Website builder blocks
    'navbar','hero','features','pricing','cta','footer','gallery','testimonial'
  ));

COMMIT;
