-- Diversity aggregates (MOTION-PLAN D1/D2) need the chosen slug/font/signature
-- per project WITHOUT opening every frozen contract JSON: 50 businesses would
-- mean 50 object-store reads per design run. Mirrored at contract-freeze time;
-- rows created before this migration stay NULL and simply do not count.
ALTER TABLE site_projects ADD COLUMN IF NOT EXISTS reference_slug text;
ALTER TABLE site_projects ADD COLUMN IF NOT EXISTS display_font text;
ALTER TABLE site_projects ADD COLUMN IF NOT EXISTS signature text;
