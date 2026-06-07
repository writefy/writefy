-- ================================================================
--  WRITEIFY — SUPABASE SQL SCHEMA
--  Paste this entire file into:
--  Supabase Dashboard → SQL Editor → New Query → Run (F5)
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- TABLE: site_settings
-- Stores every admin panel setting.
-- Every visitor fetches from this table on page load.
-- Admin panel writes to this table on every save.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_settings (
  key         TEXT PRIMARY KEY,          -- setting name  e.g. 'publisherId'
  value       TEXT        DEFAULT '',    -- setting value (always stored as text/JSON string)
  updated_at  TIMESTAMPTZ DEFAULT NOW()  -- auto-updated on every change
);

-- ── Row Level Security ───────────────────────────────────────────
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- ✅ Anyone (including visitors) can READ settings
--    This is how every visitor gets the live ad slots, site name, fonts etc.
CREATE POLICY "public_read_site_settings"
  ON public.site_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ✅ Anyone can INSERT (used by admin panel to create new rows)
CREATE POLICY "public_insert_site_settings"
  ON public.site_settings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ✅ Anyone can UPDATE (used by admin panel to edit existing rows)
CREATE POLICY "public_update_site_settings"
  ON public.site_settings
  FOR UPDATE
  TO anon, authenticated
  USING (true);

-- ── Auto-update timestamp on every change ────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_site_settings_touch ON public.site_settings;
CREATE TRIGGER trg_site_settings_touch
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();


-- ────────────────────────────────────────────────────────────────
-- SEED DEFAULT VALUES
-- These are the starting values. Admin panel will overwrite them.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.site_settings (key, value) VALUES

  -- ── Site Identity ────────────────────────────────────────────
  ('siteName',          'Writeify'),
  ('siteDescription',   'Convert your text to beautiful handwriting with multiple colors, fonts, and paper styles.'),
  ('siteKeywords',      'text to handwriting, handwriting converter, handwriting generator, multicolor handwriting'),
  ('siteAuthor',        'Writeify'),
  ('supportEmail',      'support@writeify.online'),

  -- ── SEO / Open Graph ─────────────────────────────────────────
  ('ogTitle',           'Writeify - Text to Handwriting'),
  ('ogDescription',     'Convert text to beautiful multi-color handwriting. Download as PNG or PDF for free.'),

  -- ── Analytics ────────────────────────────────────────────────
  ('analyticsId',       ''),  -- e.g. G-XXXXXXXXXX

  -- ── Ad Network ───────────────────────────────────────────────
  ('publisherId',       ''),  -- e.g. ca-pub-XXXXXXXXXXXXXXXXX
  ('adSlot1',           ''),  -- Top leaderboard slot ID
  ('adSlot2',           ''),  -- Sidebar rectangle slot ID
  ('adSlot3',           ''),  -- Bottom banner slot ID
  ('adNetworkScript',   ''),  -- Full <script> tag from ad network
  ('adNetworkMeta',     ''),  -- Optional meta verification tag

  -- ── Custom Fonts (JSON array) ─────────────────────────────────
  -- Format: [{"family":"Pacifico","label":"Pacifico"}, ...]
  ('customFonts',       '[]'),

  -- ── Custom Colors (JSON array) ────────────────────────────────
  -- Format: [{"hex":"#ff0000","label":"Bright Red"}, ...]
  ('customColors',      '[]')

ON CONFLICT (key) DO NOTHING;  -- Don't overwrite if rows already exist


-- ────────────────────────────────────────────────────────────────
-- HELPER VIEW: admin_overview
-- Quick summary for checking current settings at a glance
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.admin_overview AS
SELECT
  key,
  CASE
    WHEN LENGTH(value) > 60 THEN LEFT(value, 60) || '…'
    ELSE value
  END AS value_preview,
  CASE
    WHEN value = '' OR value = '[]' OR value IS NULL THEN '⚠️ empty'
    ELSE '✅ set'
  END AS status,
  updated_at
FROM public.site_settings
ORDER BY key;


-- ────────────────────────────────────────────────────────────────
-- VERIFY — Run this to check everything was created correctly
-- ────────────────────────────────────────────────────────────────
SELECT key, status, updated_at
FROM public.admin_overview;

SELECT '✅ Writeify site_settings table ready! Paste URL + anon key into Admin Panel → Connection tab.' AS result;


-- ================================================================
-- QUICK REFERENCE — What each key does
-- ================================================================
--
--  KEY                 USED BY
--  ───────────────── ─────────────────────────────────────────────
--  siteName          Page title, header branding
--  siteDescription   <meta name="description"> + footer
--  siteKeywords      <meta name="keywords">
--  siteAuthor        <meta name="author">
--  supportEmail      Contact page, footer email link
--  ogTitle           Open Graph / social share title
--  ogDescription     Open Graph / social share description
--  analyticsId       Google Analytics script injection
--  publisherId       AdSense ca-pub-XXXX (enables real ads)
--  adSlot1           Top leaderboard ad unit ID
--  adSlot2           Sidebar rectangle ad unit ID
--  adSlot3           Bottom banner ad unit ID
--  adNetworkScript   Full <script> tag (any ad network)
--  adNetworkMeta     Meta tag for ad network verification
--  customFonts       JSON array of added Google Fonts
--  customColors      JSON array of added ink colors
--
-- ================================================================
