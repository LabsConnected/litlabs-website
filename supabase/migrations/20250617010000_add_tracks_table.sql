-- Music tracks table for LiTTree Labs dashboard
-- Stores metadata in Supabase, audio files in R2/S3

CREATE TABLE IF NOT EXISTS tracks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT 'Unknown',
    album TEXT,
    duration_seconds INTEGER, -- track length in seconds
    storage_provider TEXT NOT NULL DEFAULT 'r2', -- 'r2', 's3', 'supabase', 'url'
    storage_bucket TEXT, -- bucket name (for r2/s3)
    storage_key TEXT, -- path within bucket (e.g., "music/track-1.mp3")
    public_url TEXT, -- direct URL if external (SoundHelix, etc.)
    cover_art_url TEXT, -- album artwork
    genre TEXT DEFAULT 'synthwave',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for active tracks sorted by order
CREATE INDEX IF NOT EXISTS idx_tracks_active_order ON tracks(is_active, sort_order);

-- Insert default royalty-free synthwave tracks (using SoundHelix)
INSERT INTO tracks (title, artist, storage_provider, public_url, sort_order, genre) VALUES
    ('Neon Horizon', 'Synthwave Radio', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', 1, 'synthwave'),
    ('Night Drive', 'Kavinsky Style', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', 2, 'synthwave'),
    ('Cyber City', 'Darksynth', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', 3, 'darksynth'),
    ('Retrowave', 'Outrun FM', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', 4, 'retrowave'),
    ('Midnight Run', 'Synthwave OG', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', 5, 'synthwave'),
    ('Neon Dreams', 'Future Funk', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', 6, 'futuresynth')
ON CONFLICT DO NOTHING;

-- Function to update play count
CREATE OR REPLACE FUNCTION increment_track_plays(track_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE tracks SET play_count = play_count + 1 WHERE id = track_id;
END;
$$ LANGUAGE plpgsql;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tracks_updated_at ON tracks;
CREATE TRIGGER update_tracks_updated_at
    BEFORE UPDATE ON tracks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
